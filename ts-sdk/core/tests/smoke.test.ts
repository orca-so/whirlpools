import { describe, it } from "vitest";
import type {
  PositionFacade,
  TickArrayFacade,
  TickFacade,
  WhirlpoolFacade,
} from "../dist/nodejs/orca_whirlpools_core_js_bindings";
import {
  collectFeesQuote,
  collectRewardsQuote,
  decreaseLiquidityQuote,
  increaseLiquidityQuote,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "../dist/nodejs/orca_whirlpools_core_js_bindings";
import assert from "assert";

// Assumption: if a complex test cases produces the same result as the rust test,
// then the WASM bundle is working correctly and we don't need to test every single
// function in the WASM bundle.

function testWhirlpool(): WhirlpoolFacade {
  return {
    tickCurrentIndex: 0,
    feeGrowthGlobalA: 800n,
    feeGrowthGlobalB: 1000n,
    feeRate: 3000,
    liquidity: 265000n,
    sqrtPrice: 1n << 64n,
    tickSpacing: 2,
    rewardLastUpdatedTimestamp: 0n,
    rewardInfos: [
      {
        growthGlobalX64: 500n,
        emissionsPerSecondX64: 1n,
      },
      {
        growthGlobalX64: 600n,
        emissionsPerSecondX64: 2n,
      },
      {
        growthGlobalX64: 700n,
        emissionsPerSecondX64: 3n,
      },
    ],
  };
}

function testTick(positive: boolean = true): TickFacade {
  const liquidityNet = positive ? 1000n : -1000n;
  return {
    initialized: true,
    liquidityNet,
    feeGrowthOutsideA: 50n,
    feeGrowthOutsideB: 20n,
    rewardGrowthsOutside: [10n, 20n, 30n],
  };
}

function testTickArray(startTickIndex: number): TickArrayFacade {
  return {
    startTickIndex,
    ticks: Array.from({ length: 88 }, () => testTick(startTickIndex < 0)),
  };
}

function testPosition(): PositionFacade {
  return {
    liquidity: 50n,
    tickLowerIndex: -5,
    tickUpperIndex: 5,
    feeGrowthCheckpointA: 0n,
    feeOwedA: 400n,
    feeGrowthCheckpointB: 0n,
    feeOwedB: 600n,
    rewardInfos: [
      {
        growthInsideCheckpoint: 0n,
        amountOwed: 100n,
      },
      {
        growthInsideCheckpoint: 0n,
        amountOwed: 200n,
      },
      {
        growthInsideCheckpoint: 0n,
        amountOwed: 300n,
      },
    ],
  };
}

describe("WASM bundle smoke test", () => {
  it("SwapIn", async () => {
    const result = swapQuoteByInputToken(1000n, false, 1000, testWhirlpool(), [
      testTickArray(0),
      testTickArray(176),
      testTickArray(352),
      testTickArray(-176),
      testTickArray(-352),
    ]);
    assert.strictEqual(result.tokenIn, 1000n);
    assert.strictEqual(result.tokenEstOut, 918n);
    assert.strictEqual(result.tokenMinOut, 826n);
    assert.strictEqual(result.tradeFee, 39n);
  });

  it("SwapOut", async () => {
    const result = swapQuoteByOutputToken(1000n, true, 1000, testWhirlpool(), [
      testTickArray(0),
      testTickArray(176),
      testTickArray(352),
      testTickArray(-176),
      testTickArray(-352),
    ]);
    assert.strictEqual(result.tokenOut, 1000n);
    assert.strictEqual(result.tokenEstIn, 1088n);
    assert.strictEqual(result.tokenMaxIn, 1197n);
    assert.strictEqual(result.tradeFee, 42n);
  });

  it("IncreaseLiquidity", async () => {
    const result = increaseLiquidityQuote(
      1000000n,
      100,
      18446744073709551616n,
      -10,
      10,
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 1000, maxFee: 100000n },
    );
    assert.strictEqual(result.liquidityDelta, 1000000n);
    assert.strictEqual(result.tokenEstA, 625n);
    assert.strictEqual(result.tokenEstB, 556n);
    assert.strictEqual(result.tokenMaxA, 632n);
    assert.strictEqual(result.tokenMaxB, 562n);
  });

  it("DecreaseLiquidity", async () => {
    const result = decreaseLiquidityQuote(
      1000000n,
      100,
      18446744073709551616n,
      -10,
      10,
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 1000, maxFee: 100000n },
    );
    assert.strictEqual(result.liquidityDelta, 1000000n);
    assert.strictEqual(result.tokenEstA, 400n);
    assert.strictEqual(result.tokenEstB, 450n);
    assert.strictEqual(result.tokenMinA, 396n);
    assert.strictEqual(result.tokenMinB, 445n);
  });

  it("CollectFeesQuote", async () => {
    const result = collectFeesQuote(
      testWhirlpool(),
      testPosition(),
      testTick(),
      testTick(),
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 5000, maxFee: 100000n },
    );
    assert.strictEqual(result.feeOwedA, 320n);
    assert.strictEqual(result.feeOwedB, 300n);
  });

  it("CollectRewardsQuote", async () => {
    const result = collectRewardsQuote(
      testWhirlpool(),
      testPosition(),
      testTick(),
      testTick(),
      10n,
      { feeBps: 1000, maxFee: 100000n },
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 3000, maxFee: 100000n },
    );
    assert.strictEqual(result.rewardOwed1, 21690n);
    assert.strictEqual(result.rewardOwed2, 22560n);
    assert.strictEqual(result.rewardOwed3, 22610n);
  });
});
