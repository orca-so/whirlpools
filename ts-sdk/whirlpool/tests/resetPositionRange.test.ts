import { describe, it, beforeAll } from "vitest";
import type { Address } from "@solana/kit";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";
import {
  setupPosition,
  setupTEPosition,
  setupWhirlpool,
} from "./utils/program";
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

const positionTypes = new Map([
  ["equally centered", { tickLower: -100, tickUpper: 100 }],
  ["one sided A", { tickLower: -100, tickUpper: -1 }],
  ["one sided B", { tickLower: 1, tickUpper: 100 }],
]);

describe("Reset Position Range Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const initialLiquidity = 100_000n;
  const mints: Map<string, Address> = new Map();
  const atas: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();

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

    // setup position
    for (const [poolName, poolAddress] of pools) {
      for (const [positionTypeName, tickRange] of positionTypes) {
        const position = await setupPosition(poolAddress, {
          ...tickRange,
          liquidity: initialLiquidity,
        });
        positions.set(`${poolName} ${positionTypeName}`, position);

        const positionTE = await setupTEPosition(poolAddress, {
          ...tickRange,
          liquidity: initialLiquidity,
        });
        positions.set(`TE ${poolName} ${positionTypeName}`, positionTE);
      }
    }
  });

  const testResetPositionRange = async (
    poolName: string,
    positionName: string,
  ) => {
    // 1. Decrease liquidity to 0, because we can reset only empty position
    const positionMintAddress = positions.get(positionName)!;

    const { instructions: decreaseLiquidityIx } =
      await decreaseLiquidityInstructions(rpc, positionMintAddress, {
        liquidity: initialLiquidity,
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
          positionMintAddress: positionMintAddress,
          newTickLowerIndex: initializableLowerTickIndex,
          newTickUpperIndex: initializableUpperTickIndex,
        },
        signer,
      );

    await sendTransaction(resetInstructions);

    // verfiy if position is reset to index range user set
    const positionAddress = await getPositionAddress(positionMintAddress);
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
    for (const positionTypeName of positionTypes.keys()) {
      const positionName = `${poolName} ${positionTypeName}`;
      it(`Should reset a position for ${positionName}`, async () => {
        await testResetPositionRange(poolName, positionName);
      });
    }
  }
});
