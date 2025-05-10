import { describe, it, beforeAll } from "vitest";
import type { Address } from "@solana/kit";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";
import { setupWhirlpool } from "./utils/program";
import { openPositionInstructions } from "../src/increaseLiquidity";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { fetchPosition, getPositionAddress } from "@orca-so/whirlpools-client";
import assert from "assert";
import { getInitializableTickIndex } from "@orca-so/whirlpools-core";
import { resetPositionRangeInstructions } from "../src/resetPositionRange";
import { decreaseLiquidityInstructions } from "../src/decreaseLiquidity";

const mintTypes = new Map([
  ["A", setupMint],
  ["B", setupMint],
  ["TEA", setupMintTE],
  ["TEB", setupMintTE],
  ["TEFee", setupMintTEFee],
]);

const ataTypes = new Map([
  ["A", setupAta],
  ["B", setupAta],
  ["TEA", setupAtaTE],
  ["TEB", setupAtaTE],
  ["TEFee", setupAtaTE],
]);

const poolTypes = new Map([
  ["A-B", setupWhirlpool],
  ["A-TEA", setupWhirlpool],
  ["TEA-TEB", setupWhirlpool],
  ["A-TEFee", setupWhirlpool],
]);

describe("Reset Position Range Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const mints: Map<string, Address> = new Map();
  const atas: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();

  beforeAll(async () => {
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, { amount: tokenBalance }));
    }

    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }
  });

  const testOpenPositionInstructions = async (
    poolName: string,
    lowerPrice: number,
    upperPrice: number,
  ) => {
    const whirlpool = pools.get(poolName)!;
    const param = { liquidity: 10_000n };

    // 1. Open a new position
    const { instructions, positionMint } = await openPositionInstructions(
      rpc,
      whirlpool,
      param,
      lowerPrice,
      upperPrice,
    );

    const positionAddress = await getPositionAddress(positionMint);

    await sendTransaction(instructions);

    // 2. Decrease liquidity to 0, because we can reset only empty position
    const { instructions: decreaseLiquidityIx } =
      await decreaseLiquidityInstructions(rpc, positionMint, {
        liquidity: 10_000n,
      });

    await sendTransaction(decreaseLiquidityIx);

    // 3. Reset the position range with initializable tick index
    const initializableLowerTickIndex = getInitializableTickIndex(
      -400,
      tickSpacing,
      false,
    );
    const initializableUpperTickIndex = getInitializableTickIndex(
      300,
      tickSpacing,
      true,
    );

    const { instructions: resetInstructions } =
      await resetPositionRangeInstructions(
        rpc,
        {
          positionMintAddress: positionMint,
          newTickLowerIndex: initializableLowerTickIndex,
          newTickUpperIndex: initializableUpperTickIndex,
        },
        signer,
      );

    await sendTransaction(resetInstructions);

    // verfiy if position is reset to index range user set
    const positionAfter = await fetchPosition(rpc, positionAddress[0]);
    assert.strictEqual(
      positionAfter.data.tickLowerIndex,
      initializableLowerTickIndex,
    );
    assert.strictEqual(
      positionAfter.data.tickUpperIndex,
      initializableUpperTickIndex,
    );
  };

  for (const poolName of poolTypes.keys()) {
    it(`Should reset a position with a specific price range for ${poolName}`, async () => {
      await testOpenPositionInstructions(poolName, 0.95, 1.05);
    });
  }
});
