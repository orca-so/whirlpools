import { describe, it, beforeAll } from "vitest";
import {
  createConcentratedLiquidityPoolInstructions,
  createSplashPoolInstructions,
} from "../src/createPool";
import {
  openFullRangePositionInstructions,
  increaseLiquidityInstructions,
} from "../src/increaseLiquidity";
import { sendTransaction, rpc } from "./utils/mockRpc";
import { SPLASH_POOL_TICK_SPACING } from "../src/config";
import { swapInstructions } from "../src/swap";
import type { Address } from "@solana/web3.js";
import { harvestPositionInstructions } from "../src/harvest";
import {
  decreaseLiquidityInstructions,
  closePositionInstructions,
} from "../src/decreaseLiquidity";
import { fetchToken } from "@solana-program/token";
import {
  fetchPosition,
  fetchWhirlpool,
  getPositionAddress,
} from "@orca-so/whirlpools-client";
import assert from "assert";
import { setupAta, setupMint } from "./utils/token";
import { orderMints } from "../src/token";

describe("e2e", () => {
  let mintA: Address;
  let mintB: Address;
  let ataA: Address;
  let ataB: Address;

  beforeAll(async () => {
    const mint1 = await setupMint({ decimals: 9 });
    const mint2 = await setupMint({ decimals: 6 });
    [mintA, mintB] = orderMints(mint1, mint2);
    ataA = await setupAta(mintA, { amount: 500e9 });
    ataB = await setupAta(mintB, { amount: 500e9 });
  });

  const fetchPositionByMint = async (positionMint: Address) => {
    const positionAddress = await getPositionAddress(positionMint);
    return await fetchPosition(rpc, positionAddress[0]);
  };

  const testInitSplashPool = async () => {
    const { instructions: createPoolInstructions, poolAddress } =
      await createSplashPoolInstructions(rpc, mintA, mintB);
    await sendTransaction(createPoolInstructions);

    const pool = await fetchWhirlpool(rpc, poolAddress);
    assert.strictEqual(pool.data.tokenMintA, mintA);
    assert.strictEqual(pool.data.tokenMintB, mintB);
    assert.strictEqual(pool.data.tickSpacing, SPLASH_POOL_TICK_SPACING);

    return poolAddress;
  };

  const testInitConcentratedLiquidityPool = async () => {
    const { instructions: createPoolInstructions, poolAddress } =
      await createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, 128);
    await sendTransaction(createPoolInstructions);

    const pool = await fetchWhirlpool(rpc, poolAddress);
    assert.strictEqual(pool.data.tokenMintA, mintA);
    assert.strictEqual(pool.data.tokenMintB, mintB);
    assert.strictEqual(pool.data.tickSpacing, 128);

    return poolAddress;
  };

  const testOpenPosition = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, positionMint, quote } =
      await openFullRangePositionInstructions(rpc, poolAddress, {
        liquidity: 1000000000n,
      });
    await sendTransaction(instructions);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(quote.liquidityDelta, positionAfter.data.liquidity);
    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      -quote.tokenEstA,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      -quote.tokenEstB,
    );

    return positionMint;
  };

  const testIncreaseLiquidity = async (positionMint: Address) => {
    const positionBefore = await fetchPositionByMint(positionMint);
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await increaseLiquidityInstructions(
      rpc,
      positionMint,
      { liquidity: 10000n },
    );
    await sendTransaction(instructions);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(
      positionAfter.data.liquidity - positionBefore.data.liquidity,
      quote.liquidityDelta,
    );
    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      -quote.tokenEstA,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      -quote.tokenEstB,
    );
  };

  const testDecreaseLiquidity = async (positionMint: Address) => {
    const positionBefore = await fetchPositionByMint(positionMint);
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await decreaseLiquidityInstructions(
      rpc,
      positionMint,
      { liquidity: 10000n },
    );
    await sendTransaction(instructions);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(
      positionAfter.data.liquidity - positionBefore.data.liquidity,
      -quote.liquidityDelta,
    );
    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      quote.tokenEstA,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      quote.tokenEstB,
    );
  };

  const testHarvest = async (positionMint: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, feesQuote } = await harvestPositionInstructions(
      rpc,
      positionMint,
    );
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      feesQuote.feeOwedA,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      feesQuote.feeOwedB,
    );
  };

  const testClosePosition = async (positionMint: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote, feesQuote } = await closePositionInstructions(
      rpc,
      positionMint,
      { liquidity: 1000000000n },
    );
    await sendTransaction(instructions);

    const positionAfter = await rpc.getMultipleAccounts([positionMint]).send();
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.value[0], null);
    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      quote.tokenEstA + feesQuote.feeOwedA,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      quote.tokenEstB + feesQuote.feeOwedB,
    );
  };

  const testSwapAExactIn = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { inputAmount: 100n, mint: mintA },
      poolAddress,
    );
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      -quote.tokenIn,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      quote.tokenEstOut,
    );
  };

  const testSwapAExactOut = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { outputAmount: 100n, mint: mintA },
      poolAddress,
    );
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      quote.tokenOut,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      -quote.tokenEstIn,
    );
  };

  const testSwapBExactIn = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { inputAmount: 100000n, mint: mintB },
      poolAddress,
    );
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      quote.tokenEstOut,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      -quote.tokenIn,
    );
  };

  const testSwapBExactOut = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { outputAmount: 100000n, mint: mintB },
      poolAddress,
    );
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(
      tokenAAfter.data.amount - tokenABefore.data.amount,
      -quote.tokenEstIn,
    );
    assert.strictEqual(
      tokenBAfter.data.amount - tokenBBefore.data.amount,
      quote.tokenOut,
    );
  };

  it("Splash pool", async () => {
    const poolAddress = await testInitSplashPool();
    const positionMint = await testOpenPosition(poolAddress);
    await testSwapAExactIn(poolAddress);
    await testIncreaseLiquidity(positionMint);
    await testSwapAExactOut(poolAddress);
    await testHarvest(positionMint);
    await testSwapBExactIn(poolAddress);
    await testDecreaseLiquidity(positionMint);
    await testSwapBExactOut(poolAddress);
    await testClosePosition(positionMint);
  });

  it("Concentrated liquidity pool", async () => {
    const poolAddress = await testInitConcentratedLiquidityPool();
    const positionMint = await testOpenPosition(poolAddress);
    await testSwapAExactIn(poolAddress);
    await testIncreaseLiquidity(positionMint);
    await testSwapAExactOut(poolAddress);
    await testHarvest(positionMint);
    await testSwapBExactIn(poolAddress);
    await testDecreaseLiquidity(positionMint);
    await testSwapBExactOut(poolAddress);
    await testClosePosition(positionMint);
  });
});
