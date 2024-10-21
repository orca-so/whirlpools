import { describe, it, beforeAll } from "vitest";
import { createConcentratedLiquidityPoolInstructions, createSplashPoolInstructions } from "../src/createPool";
import { openFullRangePositionInstructions, increaseLiquidityInstructions } from "../src/increaseLiquidity";
import { TOKEN_MINT_1, TOKEN_MINT_2, sendTransaction, rpc, initPayer, setAccount } from "./mockRpc";
import { setDefaultFunder, SPLASH_POOL_TICK_SPACING } from "../src/config";
import { swapInstructions } from "../src/swap";
import { Address, TransactionSigner } from "@solana/web3.js";
import { harvestPositionInstructions } from "../src/harvest";
import { decreaseLiquidityInstructions, closePositionInstructions } from "../src/decreaseLiquidity";
import { AccountState, fetchToken, findAssociatedTokenPda, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { fetchPosition, fetchWhirlpool, getPositionAddress } from "@orca-so/whirlpools-client";
import assert from "assert";

describe("e2e", () => {
  let ataA: Address;
  let ataB: Address;
  let payer: TransactionSigner;

  beforeAll(async () => {
    payer = await initPayer();
    setDefaultFunder(payer);

    [ataA, ataB] = await Promise.all([
      findAssociatedTokenPda({ mint: TOKEN_MINT_1, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS }).then(x => x[0]),
      findAssociatedTokenPda({ mint: TOKEN_MINT_2, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS }).then(x => x[0]),
    ]);

    setAccount(ataA, getTokenEncoder().encode({
      mint: TOKEN_MINT_1,
      owner: payer.address,
      amount: 500e9,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0,
      closeAuthority: null,
    }), TOKEN_PROGRAM_ADDRESS);

    setAccount(ataB, getTokenEncoder().encode({
      mint: TOKEN_MINT_2,
      owner: payer.address,
      amount: 500e9,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0,
      closeAuthority: null,
    }), TOKEN_PROGRAM_ADDRESS);
  });

  const fetchPositionByMint = async (positionMint: Address) => {
    const positionAddress = await getPositionAddress(positionMint);
    return await fetchPosition(rpc, positionAddress[0]);
  }

  const testInitSplashPool = async () => {
    const { instructions: createPoolInstructions, poolAddress } = await createSplashPoolInstructions(rpc, TOKEN_MINT_1, TOKEN_MINT_2);
    await sendTransaction(createPoolInstructions, payer);

    const pool = await fetchWhirlpool(rpc, poolAddress);
    assert.strictEqual(pool.data.tokenMintA, TOKEN_MINT_1);
    assert.strictEqual(pool.data.tokenMintB, TOKEN_MINT_2);
    assert.strictEqual(pool.data.tickSpacing, SPLASH_POOL_TICK_SPACING);

    return poolAddress;
  }

  const testInitConcentratedLiquidityPool = async () => {
    const { instructions: createPoolInstructions, poolAddress } = await createConcentratedLiquidityPoolInstructions(rpc, TOKEN_MINT_1, TOKEN_MINT_2, 128);
    await sendTransaction(createPoolInstructions, payer);

    const pool = await fetchWhirlpool(rpc, poolAddress);
    assert.strictEqual(pool.data.tokenMintA, TOKEN_MINT_1);
    assert.strictEqual(pool.data.tokenMintB, TOKEN_MINT_2);
    assert.strictEqual(pool.data.tickSpacing, 128);

    return poolAddress;
  }

  const testOpenPosition = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, positionMint, quote } = await openFullRangePositionInstructions(rpc, poolAddress, { liquidity: 1000000000n });
    await sendTransaction(instructions, payer);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(quote.liquidityDelta, positionAfter.data.liquidity);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenEstA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenEstB);

    return positionMint;
  }

  const testIncreaseLiquidity = async (positionMint: Address) => {
    const positionBefore = await fetchPositionByMint(positionMint);
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await increaseLiquidityInstructions(rpc, positionMint, { liquidity: 10000n });
    await sendTransaction(instructions, payer);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.data.liquidity - positionBefore.data.liquidity, quote.liquidityDelta);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenEstA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenEstB);
  }

  const testDecreaseLiquidity = async (positionMint: Address) => {
    const positionBefore = await fetchPositionByMint(positionMint);
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await decreaseLiquidityInstructions(rpc, positionMint, { liquidity: 10000n });
    await sendTransaction(instructions, payer);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.data.liquidity - positionBefore.data.liquidity, -quote.liquidityDelta);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenEstA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenEstB);
  }

  const testHarvest = async (positionMint: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, feesQuote } = await harvestPositionInstructions(rpc, positionMint);
    await sendTransaction(instructions, payer);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, feesQuote.feeOwedA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, feesQuote.feeOwedB);
  }

  const testClosePosition = async (positionMint: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote, feesQuote } = await closePositionInstructions(rpc, positionMint, { liquidity: 1000000000n });
    await sendTransaction(instructions, payer);

    const positionAfter = await rpc.getMultipleAccounts([positionMint]).send();
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.value[0], null);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenEstA + feesQuote.feeOwedA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenEstB + feesQuote.feeOwedB);
  }

  const testSwapAExactIn = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { inputAmount: 100n, mint: TOKEN_MINT_1 }, poolAddress);
    await sendTransaction(instructions, payer);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenIn);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenEstOut);
  }

  const testSwapAExactOut = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { outputAmount: 100n, mint: TOKEN_MINT_1 }, poolAddress);
    await sendTransaction(instructions, payer);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenOut);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenEstIn);
  }

  const testSwapBExactIn = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { inputAmount: 100000n, mint: TOKEN_MINT_2 }, poolAddress);
    await sendTransaction(instructions, payer);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenEstOut);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenIn);
  }

  const testSwapBExactOut = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { outputAmount: 100000n, mint: TOKEN_MINT_2 }, poolAddress);
    await sendTransaction(instructions, payer);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenEstIn);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenOut);
  }

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

  it.skip("Concentrated liquidity pool", async () => {
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
