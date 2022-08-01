import { Percentage } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import { BN } from "bn.js";
import {
  buildWhirlpoolClient,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  PriceMath,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  TICK_ARRAY_SIZE,
  WhirlpoolContext,
} from "../../../../src";
import { SwapErrorCode, WhirlpoolsError } from "../../../../src/errors/errors";
import { assertInputOutputQuoteEqual, assertQuoteAndResults, TickSpacing } from "../../../utils";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest,
} from "../../../utils/swap-test-utils";
import { getVaultAmounts } from "../../../utils/whirlpools-test-utils";

describe("swap traversal tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  /**
   * |--------------------|b-----x2----a-------b-|x1-a------------------|
   */
  it("curr_index on the last initializable tick, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 15 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 44 },
          { arrayIndex: 0, offsetIndex: 30 },
          tickSpacing,
          new BN(250_000)
        ),
        buildPosition(
          //b
          { arrayIndex: -1, offsetIndex: 0 },
          { arrayIndex: -1, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(350_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(150000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );

    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);

    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |--------------------x1,a|-b--------a----x2---b-|-------------------|
   */
  it("curr_index on the last initializable tick, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
      tickSpacing
    );
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
          { arrayIndex: 1, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: 1, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(190000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);

    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * b|-----x2---------|a---------------|a,x1-------------b|
   */
  it("curr_index on the first initializable tick, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 0 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 0 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: -2, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(200000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * b|a,x1--------------|a---------------|---------x2--------b|
   */
  it("curr_index on the first initializable tick, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 0 }, tickSpacing);
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 0 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: -1, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(450000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |--------b-----x1-a|------a---x2---b--|-------------------|
   */
  it("curr_index on the 2nd last initialized tick, with the next tick initialized, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 2 }, // 5504
      tickSpacing
    );
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
          { arrayIndex: 1, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: 0, offsetIndex: 44 },
          { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 4 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(150000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |-----------b--x2--|-------a-----b-----|a-x1-------------|
   */
  it("curr_index on the 2nd initialized tick, with the first tick initialized, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 2, offsetIndex: 1 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 1, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 0 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: 0, offsetIndex: 44 },
          { arrayIndex: 1, offsetIndex: 64 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(75000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |--------b-----a-x1|a---------x2---b--|-------------------|
   */
  it("curr_index btw end of last offset and next array, with the next tick initialized, b->a", async () => {
    const currIndex = 5629;
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
          { arrayIndex: 1, offsetIndex: 1 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: 0, offsetIndex: 44 },
          { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 4 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(15000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |-----------b--x2--|-------a-----b-----|x1,a-------------|
   */
  it("curr_index btw end of last offset and next array, with the next tick initialized, a->b", async () => {
    const currIndex = 11264 + 30;
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 1, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 0 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: 0, offsetIndex: 44 },
          { arrayIndex: 1, offsetIndex: 64 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(7500000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |----------------|-----a----x2-----b|--------x1----a---b----|
   */
  it("on some tick, traverse to the 1st initialized tick in the next tick-array, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 2, offsetIndex: 22 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 1, offsetIndex: 44 },
          { arrayIndex: 2, offsetIndex: 44 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 1 },
          { arrayIndex: 2, offsetIndex: 64 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(45000000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |----a--b---x1------|a---x2-----b-------|------------------|
   */
  it("on some tick, traverse to the 1st initialized tick in the next tick-array, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 64 }, tickSpacing);
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 0, offsetIndex: 0 },
          tickSpacing,
          new BN(250_000_000)
        ),
        buildPosition(
          //b
          { arrayIndex: -1, offsetIndex: 22 },
          { arrayIndex: 0, offsetIndex: 64 },
          tickSpacing,
          new BN(350_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(49500000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |-------a----x2------|-----------------|----x1-----a-------|
   */
  it("on some tick, traverse to the next tick in the n+2 tick-array, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 22 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 1, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(119500000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |-------a------x1----|-----------------|-----x2--------a---|
   */
  it("on some tick, traverse to the next tick in the n+2 tick-array, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 1, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(119500000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * a|----------------|-----------------|-------x1--------|a
   */
  it("3 arrays, on some initialized tick, no other initialized tick in the sequence, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 22 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(119500000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * |-----x1-------------|-----------------|-------------------|
   */
  it("3 arrays, on some initialized tick, no other initialized tick in the sequence, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(159500000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * [1, 0, -1]
   * e|---c--x2----a---d----b|f-----a--b----d----|f-----c---x1-------|e
   */
  it("3 arrays, on some uninitialized tick, traverse lots of ticks, a->b", async () => {
    const currIndex =
      arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 25 }, tickSpacing) - 30;
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // e
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000)
        ),
        buildPosition(
          // c
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 1, offsetIndex: 15 },
          tickSpacing,
          new BN(100_000_000)
        ),
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 30 },
          { arrayIndex: 0, offsetIndex: 20 },
          tickSpacing,
          new BN(100_000_000)
        ),
        buildPosition(
          // d
          { arrayIndex: -1, offsetIndex: 60 },
          { arrayIndex: 0, offsetIndex: 60 },
          tickSpacing,
          new BN(50_000_000)
        ),
        buildPosition(
          // f
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 0 },
          tickSpacing,
          new BN(25_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64(102195000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * e|---c--x1----a---d--b---|f-----a--b----d----|f------c---x2--------|e
   */
  it("3 arrays, on some uninitialized tick, traverse lots of ticks, b->a", async () => {
    const currIndex =
      arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 15 }, tickSpacing) - 30;
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // e
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000)
        ),
        buildPosition(
          // c
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 1, offsetIndex: 15 },
          tickSpacing,
          new BN(100_000_000)
        ),
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 30 },
          { arrayIndex: 0, offsetIndex: 20 },
          tickSpacing,
          new BN(100_000_000)
        ),
        buildPosition(
          // d
          { arrayIndex: -1, offsetIndex: 60 },
          { arrayIndex: 0, offsetIndex: 60 },
          tickSpacing,
          new BN(50_000_000)
        ),
        buildPosition(
          // f
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 0 },
          tickSpacing,
          new BN(25_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(99900000),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    const outputTokenQuote = await swapQuoteByOutputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * trade amount > liquidity
   * |----------x1----------|-----------------|-------------------|
   */
  it("3 arrays, trade amount exceeds liquidity available in array sequence, b->a", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    await assert.rejects(
      async () =>
        await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new u64(9159500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,

          true
        ),
      (err) => {
        const whirlErr = err as WhirlpoolsError;
        const errorMatch = whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
        // Message contains failure on finding beyond tickIndex
        const messageMatch = whirlErr.message.indexOf("11264") >= 0;
        assert.ok(messageMatch, "Error Message must match condition.");
        assert.ok(errorMatch, "Error Code must match condition.");
        return true;
      }
    );
  });

  /**
   * trade amount > liquidity
   * |--------------------|-----------------|---------x1----------|
   */
  it("3 arrays, trade amount exceeds liquidity available in array sequence, a->b", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 22 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -2, offsetIndex: 10 },
          { arrayIndex: 2, offsetIndex: 23 },
          tickSpacing,
          new BN(250_000_000)
        ),
      ],
    });

    const whirlpoolData = await whirlpool.refreshData();
    await assert.rejects(
      async () =>
        await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new u64(9159500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,

          true
        ),
      (err) => {
        const whirlErr = err as WhirlpoolsError;
        const errorMatch = whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
        // Message contains failure on finding beyond tickIndex
        const messageMatch = whirlErr.message.indexOf("-5696") >= 0;
        assert.ok(messageMatch, "Error Message must match condition.");
        assert.ok(errorMatch, "Error Code must match condition.");
        return true;
      }
    );
  });

  /**
   * |a--------x1----------a| Max
   */
  it("on the last tick-array, traverse to the MAX_TICK_INDEX tick", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 78, offsetIndex: 22 }, tickSpacing);
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [MAX_TICK_INDEX],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: 78, offsetIndex: 0 }, // 439,296
          { arrayIndex: 78, offsetIndex: 67 }, // 443,584
          tickSpacing,
          new BN(250)
        ),
      ],
      tokenMintAmount: new BN("95000000000000000"),
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64("12595000000000"),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    await (await whirlpool.swap(quote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, quote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  /**
   * Min |a--------x2--------a----|-----------------|-------------------|
   */
  it("on the first tick-array, traverse to the MIN_TICK_INDEX tick", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -79, offsetIndex: 22 }, tickSpacing);
    const aToB = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [MIN_TICK_INDEX],
      fundedPositions: [
        buildPosition(
          // a -444,928
          { arrayIndex: -79, offsetIndex: 21 },
          { arrayIndex: -79, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
          new BN(250)
        ),
      ],
      tokenMintAmount: new BN("95000000000000000"),
    });

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const quote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      new u64("12595000000000"),
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      true
    );
    await (await whirlpool.swap(quote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, quote, newData, beforeVaultAmounts, afterVaultAmounts);
  });
});
