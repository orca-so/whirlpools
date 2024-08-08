import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import type { TwoHopSwapV2Params } from "../../../../src";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  PriceMath,
  UseFallbackTickArray,
  WhirlpoolContext,
  WhirlpoolIx,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import { TickSpacing } from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest,
} from "../../../utils/swap-test-utils";
import {
  buildTestAquariums,
  getDefaultAquarium,
} from "../../../utils/init-utils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("swap with fallback test", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  const SWAP_V1_DISCRIMINATOR = Buffer.from([
    0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8,
  ]);
  const SWAP_V2_DISCRIMINATOR = Buffer.from([
    0x2b, 0x04, 0xed, 0x0b, 0x1a, 0xc9, 0x1e, 0x62,
  ]);

  /**
   * |-5632-----------|0------------c2-|5632---------c1-|11264-----------|
   */
  it("a->b, on rightmost quoter, ta1 = ta2", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 1, offsetIndex: 77 },
      tickSpacing,
    );
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
          new BN(250_000_000),
        ),
        buildPosition(
          // b
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 0, offsetIndex: 87 },
          tickSpacing,
          new BN(1),
        ),
      ],
    });

    const _taNeg11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -11264,
    ).publicKey;
    const _taNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -5632,
    ).publicKey;
    const ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      0,
    ).publicKey;
    const ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      5632,
    ).publicKey;
    const ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      11264,
    ).publicKey;

    const whirlpoolData = await whirlpool.refreshData();
    const tradeAmount = new BN(50_000_000);
    const quoteNever = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Never,
    );

    const estimatedEndTickIndex = 4734; // arrayIndex: 0

    assert.equal(quoteNever.aToB, true);
    assert.equal(quoteNever.amountSpecifiedIsInput, true);
    assert.equal(quoteNever.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteNever.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteNever.tickArray0.equals(ta5632));
    assert.ok(quoteNever.tickArray1.equals(ta0));
    assert.ok(quoteNever.tickArray2.equals(ta0)); // no fallback tick array
    assert.ok(quoteNever.supplementalTickArrays === undefined);

    const quoteAlways = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    assert.equal(quoteAlways.aToB, true);
    assert.equal(quoteAlways.amountSpecifiedIsInput, true);
    assert.equal(quoteAlways.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteAlways.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteAlways.tickArray0.equals(ta5632));
    assert.ok(quoteAlways.tickArray1.equals(ta0));
    assert.ok(quoteAlways.tickArray2.equals(ta11264)); // fallback
    assert.ok(quoteAlways.supplementalTickArrays === undefined);

    const quoteSituational = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Situational,
    );

    assert.equal(quoteSituational.aToB, true);
    assert.equal(quoteSituational.amountSpecifiedIsInput, true);
    assert.equal(quoteSituational.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteSituational.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteSituational.tickArray0.equals(ta5632));
    assert.ok(quoteSituational.tickArray1.equals(ta0));
    assert.ok(quoteSituational.tickArray2.equals(ta11264)); // fallback
    assert.ok(quoteSituational.supplementalTickArrays === undefined);

    // V1 instruction will be used because we can use tickArray2 as fallback
    const tx = await whirlpool.swap(quoteAlways);
    assert.ok(
      tx
        .compressIx(true)
        .instructions.some(
          (ix) =>
            ix.programId.equals(ORCA_WHIRLPOOL_PROGRAM_ID) &&
            ix.data.subarray(0, 8).equals(SWAP_V1_DISCRIMINATOR),
        ),
    );
    await assert.doesNotReject(
      async () => await (await whirlpool.swap(quoteAlways)).buildAndExecute(),
    );
  });

  /**
   * |-5632--------c2-|0---------------|5632---------c1-|11264-----------|
   */
  it("a->b, on rightmost quoter, ta1 != ta2 (no room for fallback)", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 1, offsetIndex: 77 },
      tickSpacing,
    );
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
          new BN(250_000_000),
        ),
        buildPosition(
          // b
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 0, offsetIndex: 87 },
          tickSpacing,
          new BN(1),
        ),
      ],
    });

    const _taNeg11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -11264,
    ).publicKey;
    const taNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -5632,
    ).publicKey;
    const ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      0,
    ).publicKey;
    const ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      5632,
    ).publicKey;
    const ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      11264,
    ).publicKey;

    const whirlpoolData = await whirlpool.refreshData();
    const tradeAmount = new BN(120_000_000);
    const quoteNever = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Never,
    );

    const estimatedEndTickIndex = -1323; // arrayIndex: -1

    assert.equal(quoteNever.aToB, true);
    assert.equal(quoteNever.amountSpecifiedIsInput, true);
    assert.equal(quoteNever.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteNever.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteNever.tickArray0.equals(ta5632));
    assert.ok(quoteNever.tickArray1.equals(ta0));
    assert.ok(quoteNever.tickArray2.equals(taNeg5632)); // no fallback tick array
    assert.ok(quoteNever.supplementalTickArrays === undefined);

    const quoteAlways = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    assert.equal(quoteAlways.aToB, true);
    assert.equal(quoteAlways.amountSpecifiedIsInput, true);
    assert.equal(quoteAlways.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteAlways.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteAlways.tickArray0.equals(ta5632));
    assert.ok(quoteAlways.tickArray1.equals(ta0));
    assert.ok(quoteAlways.tickArray2.equals(taNeg5632)); // no fallback tick array
    assert.ok(quoteAlways.supplementalTickArrays?.length === 1);
    assert.ok(quoteAlways.supplementalTickArrays[0].equals(ta11264)); // fallback in supplemental

    const quoteSituational = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Situational,
    );

    assert.equal(quoteSituational.aToB, true);
    assert.equal(quoteSituational.amountSpecifiedIsInput, true);
    assert.equal(quoteSituational.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteSituational.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteSituational.tickArray0.equals(ta5632));
    assert.ok(quoteSituational.tickArray1.equals(ta0));
    assert.ok(quoteSituational.tickArray2.equals(taNeg5632)); // no fallback tick array
    assert.ok(quoteSituational.supplementalTickArrays?.length === 1);
    assert.ok(quoteSituational.supplementalTickArrays[0].equals(ta11264)); // fallback in supplemental

    // V2 instruction will be used to use supplemental tick arrays
    const tx = await whirlpool.swap(quoteAlways);
    assert.ok(
      tx
        .compressIx(true)
        .instructions.some(
          (ix) =>
            ix.programId.equals(ORCA_WHIRLPOOL_PROGRAM_ID) &&
            ix.data.subarray(0, 8).equals(SWAP_V2_DISCRIMINATOR),
        ),
    );
    await assert.doesNotReject(
      async () => await (await whirlpool.swap(quoteAlways)).buildAndExecute(),
    );
  });

  /**
   * |-5632-----------|0------------c2-|5632-c1---------|11264-----------|
   */
  it("a->b, not on rightmost quoter, ta1 = ta2", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 1, offsetIndex: 44 },
      tickSpacing,
    );
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
          new BN(250_000_000),
        ),
        buildPosition(
          // b
          { arrayIndex: 0, offsetIndex: 0 },
          { arrayIndex: 0, offsetIndex: 87 },
          tickSpacing,
          new BN(1),
        ),
      ],
    });

    const _taNeg11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -11264,
    ).publicKey;
    const _taNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -5632,
    ).publicKey;
    const ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      0,
    ).publicKey;
    const ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      5632,
    ).publicKey;
    const ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      11264,
    ).publicKey;

    const whirlpoolData = await whirlpool.refreshData();
    const tradeAmount = new BN(50_000_000);
    const quoteNever = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Never,
    );

    const estimatedEndTickIndex = 3135; // arrayIndex: 0

    assert.equal(quoteNever.aToB, true);
    assert.equal(quoteNever.amountSpecifiedIsInput, true);
    assert.equal(quoteNever.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteNever.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteNever.tickArray0.equals(ta5632));
    assert.ok(quoteNever.tickArray1.equals(ta0));
    assert.ok(quoteNever.tickArray2.equals(ta0)); // no fallback tick array
    assert.ok(quoteNever.supplementalTickArrays === undefined);

    const quoteAlways = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    assert.equal(quoteAlways.aToB, true);
    assert.equal(quoteAlways.amountSpecifiedIsInput, true);
    assert.equal(quoteAlways.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteAlways.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteAlways.tickArray0.equals(ta5632));
    assert.ok(quoteAlways.tickArray1.equals(ta0));
    assert.ok(quoteAlways.tickArray2.equals(ta11264)); // fallback
    assert.ok(quoteAlways.supplementalTickArrays === undefined);

    const quoteSituational = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintA,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Situational,
    );

    // no fallback because it is not on the rightmost quoter
    assert.equal(quoteSituational.aToB, true);
    assert.equal(quoteSituational.amountSpecifiedIsInput, true);
    assert.equal(quoteSituational.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteSituational.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteSituational.tickArray0.equals(ta5632));
    assert.ok(quoteSituational.tickArray1.equals(ta0));
    assert.ok(quoteSituational.tickArray2.equals(ta0)); // no fallback tick array
    assert.ok(quoteSituational.supplementalTickArrays === undefined);
  });

  /**
   * |-5632-----------|0-c1------------|5632---------c2-|11264-----------|
   */
  it("b->a, on leftmost quoter, ta1 = ta2", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 0, offsetIndex: 11 },
      tickSpacing,
    );
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
          new BN(250_000_000),
        ),
        buildPosition(
          // b
          { arrayIndex: 1, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 87 },
          tickSpacing,
          new BN(1),
        ),
      ],
    });

    const _taNeg11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -11264,
    ).publicKey;
    const taNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -5632,
    ).publicKey;
    const ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      0,
    ).publicKey;
    const ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      5632,
    ).publicKey;
    const _ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      11264,
    ).publicKey;

    const whirlpoolData = await whirlpool.refreshData();
    const tradeAmount = new BN(100_000_000);
    const quoteNever = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Never,
    );

    const estimatedEndTickIndex = 7218; // arrayIndex: 1

    assert.equal(quoteNever.aToB, false);
    assert.equal(quoteNever.amountSpecifiedIsInput, true);
    assert.equal(quoteNever.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteNever.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteNever.tickArray0.equals(ta0));
    assert.ok(quoteNever.tickArray1.equals(ta5632));
    assert.ok(quoteNever.tickArray2.equals(ta5632)); // no fallback tick array
    assert.ok(quoteNever.supplementalTickArrays === undefined);

    const quoteAlways = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    assert.equal(quoteAlways.aToB, false);
    assert.equal(quoteAlways.amountSpecifiedIsInput, true);
    assert.equal(quoteAlways.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteAlways.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteAlways.tickArray0.equals(ta0));
    assert.ok(quoteAlways.tickArray1.equals(ta5632));
    assert.ok(quoteAlways.tickArray2.equals(taNeg5632)); // fallback
    assert.ok(quoteAlways.supplementalTickArrays === undefined);

    const quoteSituational = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Situational,
    );

    assert.equal(quoteSituational.aToB, false);
    assert.equal(quoteSituational.amountSpecifiedIsInput, true);
    assert.equal(quoteSituational.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteSituational.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteSituational.tickArray0.equals(ta0));
    assert.ok(quoteSituational.tickArray1.equals(ta5632));
    assert.ok(quoteSituational.tickArray2.equals(taNeg5632)); // fallback
    assert.ok(quoteSituational.supplementalTickArrays === undefined);

    // V1 instruction will be used because we can use tickArray2 as fallback
    const tx = await whirlpool.swap(quoteAlways);
    assert.ok(
      tx
        .compressIx(true)
        .instructions.some(
          (ix) =>
            ix.programId.equals(ORCA_WHIRLPOOL_PROGRAM_ID) &&
            ix.data.subarray(0, 8).equals(SWAP_V1_DISCRIMINATOR),
        ),
    );
    await assert.doesNotReject(
      async () => await (await whirlpool.swap(quoteAlways)).buildAndExecute(),
    );
  });

  /**
   * |-5632-----------|0-c1------------|5632------------|11264---c2------|
   */
  it("b->a, on leftmost quoter, ta1 != ta2 (no room for fallback)", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 0, offsetIndex: 11 },
      tickSpacing,
    );
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
          new BN(250_000_000),
        ),
        buildPosition(
          // b
          { arrayIndex: 1, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 87 },
          tickSpacing,
          new BN(1),
        ),
      ],
    });

    const _taNeg11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -11264,
    ).publicKey;
    const taNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -5632,
    ).publicKey;
    const ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      0,
    ).publicKey;
    const ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      5632,
    ).publicKey;
    const ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      11264,
    ).publicKey;

    const whirlpoolData = await whirlpool.refreshData();
    const tradeAmount = new BN(200_000_000);
    const quoteNever = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Never,
    );

    const estimatedEndTickIndex = 12124; // arrayIndex: 2

    assert.equal(quoteNever.aToB, false);
    assert.equal(quoteNever.amountSpecifiedIsInput, true);
    assert.equal(quoteNever.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteNever.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteNever.tickArray0.equals(ta0));
    assert.ok(quoteNever.tickArray1.equals(ta5632));
    assert.ok(quoteNever.tickArray2.equals(ta11264)); // no fallback tick array
    assert.ok(quoteNever.supplementalTickArrays === undefined);

    const quoteAlways = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    assert.equal(quoteAlways.aToB, false);
    assert.equal(quoteAlways.amountSpecifiedIsInput, true);
    assert.equal(quoteAlways.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteAlways.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteAlways.tickArray0.equals(ta0));
    assert.ok(quoteAlways.tickArray1.equals(ta5632));
    assert.ok(quoteAlways.tickArray2.equals(ta11264)); // no fallback tick array
    assert.ok(quoteAlways.supplementalTickArrays?.length === 1);
    assert.ok(quoteAlways.supplementalTickArrays[0].equals(taNeg5632)); // fallback in supplemental

    const quoteSituational = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Situational,
    );

    assert.equal(quoteSituational.aToB, false);
    assert.equal(quoteSituational.amountSpecifiedIsInput, true);
    assert.equal(quoteSituational.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteSituational.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteSituational.tickArray0.equals(ta0));
    assert.ok(quoteSituational.tickArray1.equals(ta5632));
    assert.ok(quoteSituational.tickArray2.equals(ta11264)); // no fallback tick array
    assert.ok(quoteSituational.supplementalTickArrays?.length === 1);
    assert.ok(quoteSituational.supplementalTickArrays[0].equals(taNeg5632)); // fallback in supplemental

    // V2 instruction will be used to use supplemental tick arrays
    const tx = await whirlpool.swap(quoteAlways);
    assert.ok(
      tx
        .compressIx(true)
        .instructions.some(
          (ix) =>
            ix.programId.equals(ORCA_WHIRLPOOL_PROGRAM_ID) &&
            ix.data.subarray(0, 8).equals(SWAP_V2_DISCRIMINATOR),
        ),
    );
    await assert.doesNotReject(
      async () => await (await whirlpool.swap(quoteAlways)).buildAndExecute(),
    );
  });

  /**
   * |-5632-----------|0-------c1------|5632---------c2-|11264-----------|
   */
  it("b->a, not on leftmost quoter, ta1 = ta2", async () => {
    const currIndex = arrayTickIndexToTickIndex(
      { arrayIndex: 0, offsetIndex: 44 },
      tickSpacing,
    );
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
          new BN(250_000_000),
        ),
        buildPosition(
          // b
          { arrayIndex: 1, offsetIndex: 0 },
          { arrayIndex: 1, offsetIndex: 87 },
          tickSpacing,
          new BN(1),
        ),
      ],
    });

    const _taNeg11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -11264,
    ).publicKey;
    const taNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      -5632,
    ).publicKey;
    const ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      0,
    ).publicKey;
    const ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      5632,
    ).publicKey;
    const _ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpool.getAddress(),
      11264,
    ).publicKey;

    const whirlpoolData = await whirlpool.refreshData();
    const tradeAmount = new BN(100_000_000);
    const quoteNever = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Never,
    );

    const estimatedEndTickIndex = 8765; // arrayIndex: 1

    assert.equal(quoteNever.aToB, false);
    assert.equal(quoteNever.amountSpecifiedIsInput, true);
    assert.equal(quoteNever.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteNever.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteNever.tickArray0.equals(ta0));
    assert.ok(quoteNever.tickArray1.equals(ta5632));
    assert.ok(quoteNever.tickArray2.equals(ta5632)); // no fallback tick array
    assert.ok(quoteNever.supplementalTickArrays === undefined);

    const quoteAlways = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    assert.equal(quoteAlways.aToB, false);
    assert.equal(quoteAlways.amountSpecifiedIsInput, true);
    assert.equal(quoteAlways.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteAlways.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteAlways.tickArray0.equals(ta0));
    assert.ok(quoteAlways.tickArray1.equals(ta5632));
    assert.ok(quoteAlways.tickArray2.equals(taNeg5632)); // fallback
    assert.ok(quoteAlways.supplementalTickArrays === undefined);

    const quoteSituational = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      tradeAmount,
      slippageTolerance,
      ctx.program.programId,
      fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Situational,
    );

    // no fallback because it is not on the leftmost quoter
    assert.equal(quoteSituational.aToB, false);
    assert.equal(quoteSituational.amountSpecifiedIsInput, true);
    assert.equal(quoteSituational.estimatedEndTickIndex, estimatedEndTickIndex);
    assert.equal(quoteSituational.estimatedAmountIn.toString(), tradeAmount);
    assert.ok(quoteSituational.tickArray0.equals(ta0));
    assert.ok(quoteSituational.tickArray1.equals(ta5632));
    assert.ok(quoteSituational.tickArray2.equals(ta5632)); // no fallback tick array
    assert.ok(quoteSituational.supplementalTickArrays === undefined);
  });

  it("twoHopSwapQuoteFromSwapQuotes", async () => {
    const tickSpacing64 = 64;
    const aToB = false;

    const aqConfig = getDefaultAquarium();

    // Add a third token and account and a second pool
    aqConfig.initFeeTierParams = [{ tickSpacing: tickSpacing64 }];
    aqConfig.initMintParams.push({});
    aqConfig.initTokenAccParams.push({ mintIndex: 2 });
    aqConfig.initPoolParams = [
      {
        mintIndices: [0, 1],
        tickSpacing: tickSpacing64,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(2816),
      },
      {
        mintIndices: [1, 2],
        tickSpacing: tickSpacing64,
        initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(2816),
      },
    ];

    // Add tick arrays and positions
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 0,
      startTickIndex: -444928,
      arrayCount: 1,
      aToB,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 0,
      startTickIndex: 439296,
      arrayCount: 1,
      aToB,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: -444928,
      arrayCount: 1,
      aToB,
    });
    aqConfig.initTickArrayRangeParams.push({
      poolIndex: 1,
      startTickIndex: 439296,
      arrayCount: 1,
      aToB,
    });

    // pool1(b(2) -> a(1)) --> pool0(b(1) -> a(0)) (so pool0 has smaller liquidity)
    aqConfig.initPositionParams.push({
      poolIndex: 0,
      fundParams: [
        {
          liquidityAmount: new anchor.BN(4_100_000),
          tickLowerIndex: -443584,
          tickUpperIndex: 443584,
        },
      ],
    });
    aqConfig.initPositionParams.push({
      poolIndex: 1,
      fundParams: [
        {
          liquidityAmount: new anchor.BN(10_000_000),
          tickLowerIndex: -443584,
          tickUpperIndex: 443584,
        },
      ],
    });
    const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];

    const poolInit0 = aquarium.pools[0];
    const poolInit1 = aquarium.pools[1];
    const pool0 = await client.getPool(
      poolInit0.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    );
    const pool1 = await client.getPool(
      poolInit1.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    );

    // quote1: in 8731861 out 3740488 end tick 14080
    // quote0: in 3740488 out 1571989 end tick 14462

    const quote1 = await swapQuoteByInputToken(
      pool1,
      pool1.getData().tokenMintB,
      new BN(8731861),
      Percentage.fromFraction(0, 100),
      ORCA_WHIRLPOOL_PROGRAM_ID,
      ctx.fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    const quote0 = await swapQuoteByInputToken(
      pool0,
      pool0.getData().tokenMintB,
      quote1.estimatedAmountOut,
      Percentage.fromFraction(0, 100),
      ORCA_WHIRLPOOL_PROGRAM_ID,
      ctx.fetcher,
      IGNORE_CACHE,
      UseFallbackTickArray.Always,
    );

    const pool0TaNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool0.getAddress(),
      -5632,
    ).publicKey;
    const pool0Ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool0.getAddress(),
      0,
    ).publicKey;
    const pool0Ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool0.getAddress(),
      5632,
    ).publicKey;
    const pool0Ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool0.getAddress(),
      11264,
    ).publicKey;

    const pool1TaNeg5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool1.getAddress(),
      -5632,
    ).publicKey;
    const pool1Ta0 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool1.getAddress(),
      0,
    ).publicKey;
    const pool1Ta5632 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool1.getAddress(),
      5632,
    ).publicKey;
    const pool1Ta11264 = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool1.getAddress(),
      11264,
    ).publicKey;

    assert.ok(quote1.tickArray0.equals(pool1Ta0));
    assert.ok(quote1.tickArray1.equals(pool1Ta5632));
    assert.ok(quote1.tickArray2.equals(pool1Ta11264)); // no room for fallback
    assert.ok(quote1.supplementalTickArrays?.length === 1);
    assert.ok(quote1.supplementalTickArrays[0].equals(pool1TaNeg5632)); // fallback in supplemental

    assert.ok(quote0.tickArray0.equals(pool0Ta0));
    assert.ok(quote0.tickArray1.equals(pool0Ta5632));
    assert.ok(quote0.tickArray2.equals(pool0Ta11264)); // no room for fallback
    assert.ok(quote0.supplementalTickArrays?.length === 1);
    assert.ok(quote0.supplementalTickArrays[0].equals(pool0TaNeg5632)); // fallback in supplemental

    const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quote1, quote0);

    // verify if the twoHopQuote has supplemental tick arrays
    assert.ok(twoHopQuote.supplementalTickArraysOne?.length === 1);
    assert.ok(twoHopQuote.supplementalTickArraysOne[0].equals(pool1TaNeg5632));
    assert.ok(twoHopQuote.supplementalTickArraysTwo?.length === 1);
    assert.ok(twoHopQuote.supplementalTickArraysTwo[0].equals(pool0TaNeg5632));

    const params: TwoHopSwapV2Params = {
      ...twoHopQuote,
      tokenAuthority: ctx.wallet.publicKey,
      whirlpoolOne: pool1.getAddress(),
      whirlpoolTwo: pool0.getAddress(),
      oracleOne: PDAUtil.getOracle(ctx.program.programId, pool1.getAddress())
        .publicKey,
      oracleTwo: PDAUtil.getOracle(ctx.program.programId, pool0.getAddress())
        .publicKey,
      tokenProgramInput: TOKEN_PROGRAM_ID,
      tokenProgramIntermediate: TOKEN_PROGRAM_ID,
      tokenProgramOutput: TOKEN_PROGRAM_ID,
      tokenMintInput: pool1.getData().tokenMintB,
      tokenMintIntermediate: pool1.getData().tokenMintA,
      tokenMintOutput: pool0.getData().tokenMintA,
      tokenVaultOneInput: pool1.getData().tokenVaultB,
      tokenVaultOneIntermediate: pool1.getData().tokenVaultA,
      tokenVaultTwoIntermediate: pool0.getData().tokenVaultB,
      tokenVaultTwoOutput: pool0.getData().tokenVaultA,
      tokenOwnerAccountInput: aquarium.tokenAccounts[2].account,
      tokenOwnerAccountOutput: aquarium.tokenAccounts[0].account,
    };

    // verify if the params has supplemental tick arrays
    assert.ok(params.supplementalTickArraysOne?.length === 1);
    assert.ok(params.supplementalTickArraysOne[0].equals(pool1TaNeg5632));
    assert.ok(params.supplementalTickArraysTwo?.length === 1);
    assert.ok(params.supplementalTickArraysTwo[0].equals(pool0TaNeg5632));

    // execute twoHopSwapV2 with supplemental tick arrays
    assert.ok(
      (await pool1.refreshData()).tickCurrentIndex !==
        quote1.estimatedEndTickIndex,
    );
    assert.ok(
      (await pool0.refreshData()).tickCurrentIndex !==
        quote0.estimatedEndTickIndex,
    );
    const tx = toTx(ctx, WhirlpoolIx.twoHopSwapV2Ix(ctx.program, params));
    await assert.doesNotReject(async () => await tx.buildAndExecute());
    assert.ok(
      (await pool1.refreshData()).tickCurrentIndex ===
        quote1.estimatedEndTickIndex,
    );
    assert.ok(
      (await pool0.refreshData()).tickCurrentIndex ===
        quote0.estimatedEndTickIndex,
    );
  });
});
