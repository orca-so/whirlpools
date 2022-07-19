import { AddressUtil, Percentage, ZERO } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import BN from "bn.js";
import {
  buildWhirlpoolClient,
  PDAUtil,
  PriceMath,
  swapQuoteByInputToken,
  swapQuoteWithParams,
  SwapUtils,
  TICK_ARRAY_SIZE,
  WhirlpoolContext,
} from "../../../../src";
import { SwapErrorCode, WhirlpoolsError } from "../../../../src/errors/errors";
import { adjustForSlippage } from "../../../../src/utils/position-util";
import { TickSpacing } from "../../../utils";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest,
} from "../../../utils/swap-test-utils";
import { getTickArrays } from "../../../utils/testDataTypes";

describe("swap arrays test", async () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, provider.wallet, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  /**
   * |-------------c2-----|xxxxxxxxxxxxxxxxx|------c1-----------|
   */
  it("3 sequential arrays, 2nd array not initialized, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const missingTickArray = PDAUtil.getTickArray(ctx.program.programId, whirlpool.getAddress(), 0);
    const expectedError = `[${missingTickArray.publicKey.toBase58()}] need to be initialized`;
    await assert.rejects(
      swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        new u64(10000),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        true
      ),
      (err: Error) => err.message.indexOf(expectedError) != -1
    );
  });

  /**
   * |-------------c1-----|xxxxxxxxxxxxxxxxx|------c2-----------|
   */
  it("3 sequential arrays, 2nd array not initialized, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const missingTickArray = PDAUtil.getTickArray(ctx.program.programId, whirlpool.getAddress(), 0);
    const expectedError = `[${missingTickArray.publicKey.toBase58()}] need to be initialized`;
    await assert.rejects(
      swapQuoteByInputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        new u64(10000),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        true
      ),
      (err: Error) => err.message.indexOf(expectedError) != -1
    );
  });

  /**
   * c1|------------------|-----------------|-------------------|
   */
  it("3 sequential arrays does not contain curr_tick_index, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -2, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = true;
    const tickArrays = await SwapUtils.getTickArrays(
      arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 10 }, tickSpacing),
      tickSpacing,
      aToB,
      ctx.program.programId,
      whirlpool.getAddress(),
      fetcher,
      true
    );
    assert.throws(
      () =>
        swapQuoteWithParams(
          {
            aToB,
            amountSpecifiedIsInput: true,
            tokenAmount: new u64("10000"),
            whirlpoolData,
            tickArrays,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            otherAmountThreshold: ZERO,
          },
          slippageTolerance
        ),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.TickArraySequenceInvalid
    );
  });

  /**
   * |--------------------|-----------------|-------------------|c1
   */
  it("3 sequential arrays does not contain curr_tick_index, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 2, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.getData();
    const aToB = false;
    const tickArrays = await SwapUtils.getTickArrays(
      arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 10 }, tickSpacing),
      tickSpacing,
      aToB,
      ctx.program.programId,
      whirlpool.getAddress(),
      fetcher,
      true
    );
    assert.throws(
      () =>
        swapQuoteWithParams(
          {
            aToB,
            amountSpecifiedIsInput: true,
            tokenAmount: new u64("10000"),
            whirlpoolData,
            tickArrays,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            otherAmountThreshold: ZERO,
          },
          slippageTolerance
        ),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.TickArraySequenceInvalid
    );
  });

  /**
   * |--------------------|------c1---------|-------------------|
   */
  it("3 sequential arrays, 2nd array contains curr_tick_index, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = true;
    const tickArrays = await SwapUtils.getTickArrays(
      arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 10 }, tickSpacing),
      tickSpacing,
      aToB,
      ctx.program.programId,
      whirlpool.getAddress(),
      fetcher,
      true
    );
    assert.throws(
      () =>
        swapQuoteWithParams(
          {
            aToB,
            amountSpecifiedIsInput: true,
            tokenAmount: new u64("10000"),
            whirlpoolData,
            tickArrays,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            otherAmountThreshold: ZERO,
          },
          slippageTolerance
        ),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.TickArraySequenceInvalid
    );
  });

  /**
   * |--------------------|------c1---------|-------------------|
   */
  it("3 sequential arrays, 2nd array contains curr_tick_index, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264, 16896],
      fundedPositions: [
        buildPosition(
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = false;
    const tickArrays = await SwapUtils.getTickArrays(
      arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 10 }, tickSpacing),
      tickSpacing,
      aToB,
      ctx.program.programId,
      whirlpool.getAddress(),
      fetcher,
      true
    );

    assert.throws(
      () =>
        swapQuoteWithParams(
          {
            aToB,
            amountSpecifiedIsInput: true,
            tokenAmount: new u64("10000"),
            whirlpoolData,
            tickArrays,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            otherAmountThreshold: ZERO,
          },
          slippageTolerance
        ),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.TickArraySequenceInvalid
    );
  });

  /**
   * |---a-c2--(5632)-----|------(0)--------|---c1--(11264)--a-|
   */
  it("on first array, 2nd array is not sequential, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 2, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          { arrayIndex: 1, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = true;
    const tickArrays = await getTickArrays(
      [11264, 0, 5632],
      ctx,
      AddressUtil.toPubKey(whirlpool.getAddress()),
      fetcher
    );
    assert.throws(
      () =>
        swapQuoteWithParams(
          {
            aToB,
            amountSpecifiedIsInput: true,
            tokenAmount: new u64("10000"),
            whirlpoolData,
            tickArrays,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            otherAmountThreshold: ZERO,
          },
          slippageTolerance
        ),
      (err) => {
        const whirlErr = err as WhirlpoolsError;
        const errorCodeMatch = whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
        const messageMatch = whirlErr.message.indexOf("TickArray at index 1 is unexpected") >= 0;
        return errorCodeMatch && messageMatch;
      }
    );
  });

  /**
   * |-a--(-11264)---c1---|--------(0)------|----(-5632)---c2--a-|
   */
  it("on first array, 2nd array is not sequential, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -2, offsetIndex: 44 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: -1, offsetIndex: TICK_ARRAY_SIZE - 2 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = false;
    const tickArrays = await getTickArrays(
      [-11264, 0, -5632],
      ctx,
      AddressUtil.toPubKey(whirlpool.getAddress()),
      fetcher
    );
    assert.throws(
      () =>
        swapQuoteWithParams(
          {
            aToB,
            amountSpecifiedIsInput: true,
            tokenAmount: new u64("10000"),
            whirlpoolData,
            tickArrays,
            sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
            otherAmountThreshold: ZERO,
          },
          slippageTolerance
        ),
      (err) => {
        const whirlErr = err as WhirlpoolsError;
        const errorCodeMatch = whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
        const messageMatch = whirlErr.message.indexOf("TickArray at index 1 is unexpected") >= 0;
        return errorCodeMatch && messageMatch;
      }
    );
  });

  /**
   * |-------(5632)------|-------(5632)------|---c2--(5632)-c1---|
   */
  it("3 identical arrays, 1st contains curr_tick_index, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 4 },
      tickSpacing
    );
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [5632],
      fundedPositions: [
        buildPosition(
          { arrayIndex: 1, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(250_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = true;
    const tickArrays = await getTickArrays(
      [5632, 5632, 5632],
      ctx,
      AddressUtil.toPubKey(whirlpool.getAddress()),
      fetcher
    );
    const tradeAmount = new u64("33588");
    const quote = swapQuoteWithParams(
      {
        aToB,
        amountSpecifiedIsInput: true,
        tokenAmount: tradeAmount,
        whirlpoolData,
        tickArrays,
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
        otherAmountThreshold: ZERO,
      },
      slippageTolerance
    );

    // Verify with an actual swap.
    assert.equal(quote.aToB, aToB);
    assert.equal(quote.amountSpecifiedIsInput, true);
    assert.equal(
      quote.sqrtPriceLimit.toString(),
      SwapUtils.getDefaultSqrtPriceLimit(aToB).toString()
    );
    assert.equal(
      quote.otherAmountThreshold.toString(),
      adjustForSlippage(quote.estimatedAmountOut, slippageTolerance, false).toString()
    );
    assert.equal(quote.estimatedAmountIn.toString(), tradeAmount);
    assert.doesNotThrow(async () => await (await whirlpool.swap(quote)).buildAndExecute());
  });

  /**
   * |---c1--(5632)-c2---|-------(5632)------|-------(5632)------|
   */
  it("3 identical arrays, 1st contains curr_tick_index, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 4 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [5632],
      fundedPositions: [
        buildPosition(
          { arrayIndex: 1, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(250_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const aToB = false;
    const tickArrays = await getTickArrays(
      [5632, 5632, 5632],
      ctx,
      AddressUtil.toPubKey(whirlpool.getAddress()),
      fetcher
    );
    const tradeAmount = new u64("33588");
    const quote = swapQuoteWithParams(
      {
        aToB,
        amountSpecifiedIsInput: true,
        tokenAmount: tradeAmount,
        whirlpoolData,
        tickArrays,
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
        otherAmountThreshold: ZERO,
      },
      slippageTolerance
    );

    // Verify with an actual swap.
    assert.equal(quote.aToB, aToB);
    assert.equal(quote.amountSpecifiedIsInput, true);
    assert.equal(
      quote.sqrtPriceLimit.toString(),
      SwapUtils.getDefaultSqrtPriceLimit(aToB).toString()
    );
    assert.equal(
      quote.otherAmountThreshold.toString(),
      adjustForSlippage(quote.estimatedAmountOut, slippageTolerance, false).toString()
    );
    assert.equal(quote.estimatedAmountIn.toString(), tradeAmount);
    assert.doesNotThrow(async () => await (await whirlpool.swap(quote)).buildAndExecute());
  });
});
