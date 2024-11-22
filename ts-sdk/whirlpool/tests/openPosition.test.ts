import { describe, it, beforeAll } from "vitest";
import type { Address} from "@solana/web3.js";
import { assertAccountExists } from "@solana/web3.js";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";
import { setupWhirlpool } from "./utils/program";
import {
  openFullRangePositionInstructions,
  openPositionInstructions,
} from "../src/increaseLiquidity";
import { rpc, sendTransaction } from "./utils/mockRpc";
import {
  fetchMaybePosition,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import assert from "assert";
import { SPLASH_POOL_TICK_SPACING } from "../src/config";

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

describe("Open Position Instructions", () => {
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

  const testOpenPosition = async (
    poolName: string,
    lowerPrice?: number,
    upperPrice?: number,
  ) => {
    const whirlpool = pools.get(poolName)!;
    const param = { liquidity: 10_000n };

    const { instructions, positionMint } =
      lowerPrice === undefined || upperPrice === undefined
        ? await openFullRangePositionInstructions(rpc, whirlpool, param)
        : await openPositionInstructions(
            rpc,
            whirlpool,
            param,
            lowerPrice,
            upperPrice,
          );

    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionMint);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);
  };

  for (const poolName of poolTypes.keys()) {
    it(`Should open a full-range position for ${poolName}`, async () => {
      await testOpenPosition(poolName);
    });

    it(`Should open a position with a specific price range for ${poolName}`, async () => {
      await testOpenPosition(poolName, 0.95, 1.05);
    });
  }

  it("Should compute correct initialization costs if both tick arrays are already initialized", async () => {
    const param = { liquidity: 10_000n };

    const { instructions, initializationCost } = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      param,
      0.95,
      1.05,
    );

    await sendTransaction(instructions);

    assert.strictEqual(initializationCost, 0n);
  });

  it("Should compute correct initialization costs if 1 tick array is already initialized", async () => {
    const param = { liquidity: 10_000n };

    const { instructions, initializationCost } = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      param,
      0.05,
      1.05,
    );

    await sendTransaction(instructions);

    assert.strictEqual(initializationCost, 70407360n);
  });

  it("Should compute correct initialization costs if no tick arrays are already initialized", async () => {
    const param = { liquidity: 10_000n };

    const { instructions, initializationCost } = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      param,
      0.01,
      5,
    );

    await sendTransaction(instructions);

    assert.strictEqual(initializationCost, 140814720n);
  });

  it("Should throw an error if openPositionInstructions is called on a splash pool", async () => {
    const param = { liquidity: 10_000n };
    const splashPool = await setupWhirlpool(
      mints.get("A")!,
      mints.get("B")!,
      SPLASH_POOL_TICK_SPACING,
    );
    await assert.rejects(
      openPositionInstructions(rpc, splashPool, param, 0.01, 5),
    );
  });
});
