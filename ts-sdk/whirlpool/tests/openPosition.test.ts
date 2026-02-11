import {
  fetchMaybePosition,
  getOpenPositionWithTokenExtensionsInstructionDataDecoder,
  getPositionAddress,
  OPEN_POSITION_WITH_TOKEN_EXTENSIONS_DISCRIMINATOR,
} from "@orca-so/whirlpools-client";
import {
  getFullRangeTickIndexes,
  getInitializableTickIndex,
  priceToTickIndex,
} from "@orca-so/whirlpools-core";
import type { Address } from "@solana/kit";
import { assertAccountExists } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import { SPLASH_POOL_TICK_SPACING } from "../src/config";
import {
  openFullRangePositionInstructions,
  openPositionInstructions,
  openPositionInstructionsWithTickBounds,
} from "../src/increaseLiquidity";
import { rpc, sendTransaction } from "./utils/mockRpc";
import { setupWhirlpool } from "./utils/program";
import { setupAta, setupMint } from "./utils/token";
import {
  setupAtaTE,
  setupMintTE,
  setupMintTEFee,
} from "./utils/tokenExtensions";

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

  const increaseLiquidityParam = { tokenMaxA: 10_000n, tokenMaxB: 10_000n };

  const testOpenPositionInstructions = async (
    poolName: string,
    lowerPrice: number,
    upperPrice: number,
  ) => {
    const whirlpool = pools.get(poolName)!;

    const { instructions, positionMint } = await openPositionInstructions(
      rpc,
      whirlpool,
      increaseLiquidityParam,
      lowerPrice,
      upperPrice,
    );

    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress[0]);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);

    const expectedTickLowerIndex = priceToTickIndex(lowerPrice, 6, 6);
    const expectedTickUpperIndex = priceToTickIndex(upperPrice, 6, 6);
    const initializableLowerTickIndex = getInitializableTickIndex(
      expectedTickLowerIndex,
      tickSpacing,
      false,
    );
    const initializableUpperTickIndex = getInitializableTickIndex(
      expectedTickUpperIndex,
      tickSpacing,
      true,
    );

    assert.strictEqual(
      positionAfter.data.tickLowerIndex,
      initializableLowerTickIndex,
    );
    assert.strictEqual(
      positionAfter.data.tickUpperIndex,
      initializableUpperTickIndex,
    );
  };

  const testOpenFullRangePositionInstructions = async (poolName: string) => {
    const whirlpool = pools.get(poolName)!;

    const { instructions, positionMint } =
      await openFullRangePositionInstructions(
        rpc,
        whirlpool,
        increaseLiquidityParam,
      );

    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress[0]);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);

    const tickRange = getFullRangeTickIndexes(tickSpacing);
    const initializableLowerTickIndex = getInitializableTickIndex(
      tickRange.tickLowerIndex,
      tickSpacing,
      false,
    );
    const initializableUpperTickIndex = getInitializableTickIndex(
      tickRange.tickUpperIndex,
      tickSpacing,
      true,
    );

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
    it(`Should open a position with a specific price range for ${poolName}`, async () => {
      await testOpenPositionInstructions(poolName, 0.95, 1.05);
    });

    it(`Should open a full-range position for ${poolName}`, async () => {
      await testOpenFullRangePositionInstructions(poolName);
    });
  }

  it("Should compute correct initialization costs if both tick arrays are already initialized", async () => {
    const { initializationCost } = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      increaseLiquidityParam,
      0.95,
      1.05,
    );

    assert.strictEqual(initializationCost, 0n);
  });

  it("Should compute correct initialization costs if 1 tick array is already initialized", async () => {
    const { initializationCost } = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      increaseLiquidityParam,
      0.05,
      1.05,
    );

    // Fixed tick array: 9988 bytes, rent = 0.070407360 SOL / tick array
    // Dynamic tick array: 148 bytes, rent = 0.001920960 SOL / tick array
    // difference: 0.068486400 SOL / tick array
    // assert.strictEqual(initializationCost, 70407360n); // Fixed tick array
    assert.strictEqual(initializationCost, 1920960n); // Dynamic tick array
  });

  it("Should compute correct initialization costs if no tick arrays are already initialized", async () => {
    const { initializationCost } = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      increaseLiquidityParam,
      0.01,
      5,
    );

    // Fixed tick array: 9988 bytes, rent = 0.070407360 SOL / tick array
    // Dynamic tick array: 148 bytes, rent = 0.001920960 SOL / tick array
    // difference: 0.068486400 SOL / tick array
    // assert.strictEqual(initializationCost, 140814720n); // Fixed tick array
    assert.strictEqual(initializationCost, 3841920n); // Dynamic tick array
  });

  it("Open position with tick bounds should result in correct tick bounds", async () => {
    const whirlpool = pools.get("A-B")!;

    const expectedTickLowerIndex = -64;
    const expectedTickUpperIndex = 64;
    const { instructions, positionMint } =
      await openPositionInstructionsWithTickBounds(
        rpc,
        whirlpool,
        increaseLiquidityParam,
        expectedTickLowerIndex,
        expectedTickUpperIndex,
        100,
        false,
      );

    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress[0]);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);

    const initializableLowerTickIndex = getInitializableTickIndex(
      expectedTickLowerIndex,
      tickSpacing,
      false,
    );
    const initializableUpperTickIndex = getInitializableTickIndex(
      expectedTickUpperIndex,
      tickSpacing,
      true,
    );

    assert.strictEqual(
      positionAfter.data.tickLowerIndex,
      initializableLowerTickIndex,
    );
    assert.strictEqual(
      positionAfter.data.tickUpperIndex,
      initializableUpperTickIndex,
    );
  });

  it("Should support explicit token extensions metadata flag", async () => {
    const whirlpool = pools.get("A-B")!;

    const { instructions } = await openPositionInstructions(
      rpc,
      whirlpool,
      increaseLiquidityParam,
      0.95,
      1.05,
      100,
      false,
    );

    const openPositionIxs = instructions.filter(({ data }) => {
      return (
        data &&
        data.length >= 8 &&
        OPEN_POSITION_WITH_TOKEN_EXTENSIONS_DISCRIMINATOR.every(
          (byte, index) => data[index] === byte,
        )
      );
    });

    assert.strictEqual(openPositionIxs.length, 1);
    const openPositionIx = openPositionIxs[0];
    const instructionData =
      getOpenPositionWithTokenExtensionsInstructionDataDecoder().decode(
        openPositionIx.data!,
      );
    assert.strictEqual(instructionData.withTokenMetadataExtension, false);
  });

  it("Should throw an error if openPositionInstructions is called on a splash pool", async () => {
    const splashPool = await setupWhirlpool(
      mints.get("A")!,
      mints.get("B")!,
      SPLASH_POOL_TICK_SPACING,
    );

    await assert.rejects(
      openPositionInstructions(
        rpc,
        splashPool,
        increaseLiquidityParam,
        0.01,
        5,
      ),
    );
  });
});
