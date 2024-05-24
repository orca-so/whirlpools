import { Percentage, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import {
  PriceMath,
  increaseLiquidityQuoteByInputTokenWithParams,
  increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage,
  increaseLiquidityQuoteByLiquidityWithParams,
} from "../../../../src";
import {
  getLiquidityFromTokenA,
  getLiquidityFromTokenB,
} from "../../../../src/utils/position-util";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../../src/utils/public/token-extension-util";

function getTestSlippageRange(currIndex: number, slippage: Percentage) {
  const sqrtPrice = PriceMath.tickIndexToSqrtPriceX64(currIndex);
  const {
    lowerBound: [_sLowerSqrtPrice, sLowerIndex],
    upperBound: [_sUpperSqrtPrice, sUpperIndex],
  } = PriceMath.getSlippageBoundForSqrtPrice(sqrtPrice, slippage);

  return {
    tickLowerIndex: sLowerIndex === sUpperIndex ? sLowerIndex - 1 : sLowerIndex,
    tickUpperIndex: sUpperIndex,
    tickCurrentIndex: currIndex,
  };
}

const variations = [
  [0, true, Percentage.fromFraction(1, 1000)] as const,
  [0, false, Percentage.fromFraction(1, 1000)] as const,
  [0, true, Percentage.fromFraction(1, 100)] as const,
  [0, false, Percentage.fromFraction(1, 100)] as const,
  [234653, true, Percentage.fromFraction(1, 1000)] as const,
  [234653, false, Percentage.fromFraction(1, 1000)] as const,
  [234653, true, Percentage.fromFraction(1, 100)] as const,
  [234653, false, Percentage.fromFraction(1, 100)] as const,
  [-234653, true, Percentage.fromFraction(1, 1000)] as const,
  [-234653, false, Percentage.fromFraction(1, 1000)] as const,
  [-234653, true, Percentage.fromFraction(1, 100)] as const,
  [-234653, false, Percentage.fromFraction(1, 100)] as const,
];

// NOTE: Slippage range for current price (tick = 0) is [-101, 99]
// [---P---] = P is the current price & [] is the slippage boundary
// |-------| = Position Boundary
variations.forEach(([currentTickIndex, isTokenA, slippage]) => {
  describe("increaseLiquidityQuoteByInputTokenUsingPriceSlippage", () => {
    const tokenMintA = new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");
    const tokenMintB = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    it(`|[--------P--------]| @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex,
        pTickUpperIndex: slippageRange.tickCurrentIndex,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`|----------------|  [---P---] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 200,
        pTickUpperIndex: slippageRange.tickLowerIndex - 100,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`|--------------[--|--P----] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 200,
        pTickUpperIndex: slippageRange.tickLowerIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[|---|---P------] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex,
        pTickUpperIndex: slippageRange.tickCurrentIndex - 1,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[--|---|--P-------] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex + 5,
        pTickUpperIndex: slippageRange.tickCurrentIndex - 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`|-----[---P---]-----| @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 200,
        pTickUpperIndex: slippageRange.tickUpperIndex + 200,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[--|----P----]-----| @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex + 5,
        pTickUpperIndex: slippageRange.tickUpperIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`|--[---P---|-----] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 125,
        pTickUpperIndex: slippageRange.tickCurrentIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[---|---P---|----] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex + 5,
        pTickUpperIndex: slippageRange.tickCurrentIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[---P---] |---------| @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickUpperIndex + 100,
        pTickUpperIndex: slippageRange.tickUpperIndex + 200,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[---P--|---]------| @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickCurrentIndex + 5,
        pTickUpperIndex: slippageRange.tickUpperIndex + 100,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[-----P--|---|] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickCurrentIndex + 5,
        pTickUpperIndex: slippageRange.tickUpperIndex,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    it(`[-------P--|---|--] @ isTokenA - ${isTokenA} tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlippageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickCurrentIndex + 2,
        pTickUpperIndex: slippageRange.tickUpperIndex - 2,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippageTolerance: slippage,
      });
    });

    function testVariation(params: {
      pTickLowerIndex: number;
      pTickUpperIndex: number;
      tickCurrentIndex: number;
      inputTokenAmount: BN;
      isTokenA: boolean;
      slippageTolerance: Percentage;
    }) {
      const { pTickLowerIndex, pTickUpperIndex, tickCurrentIndex, inputTokenAmount, isTokenA } =
        params;

      const sqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickCurrentIndex);

      const inputTokenMint = isTokenA ? tokenMintA : tokenMintB;

      const quote = increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage({
        inputTokenAmount,
        inputTokenMint,
        sqrtPrice,
        tokenMintA,
        tokenMintB,
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex,
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
        slippageTolerance: slippage,
      });

      // Expectations
      const liquidity = getLiquidityFromInputToken({
        inputTokenAmount,
        isInputTokenA: isTokenA,
        sqrtPrice,
        currentTickIndex: tickCurrentIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });

      const expectedQuote = increaseLiquidityQuoteByLiquidityWithParams({
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex,
        liquidity,
        sqrtPrice: sqrtPrice,
        slippageTolerance: slippage,
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
      });

      const {
        tokenEstA: expectedTokenEstA,
        tokenEstB: expectedTokenEstB,
        tokenMaxA: expectedTokenMaxA,
        tokenMaxB: expectedTokenMaxB,
      } = expectedQuote;

      assert.ok(
        quote.tokenEstA.eq(expectedTokenEstA),
        `tokenEstA: ${quote.tokenEstA.toString()} !== ${expectedTokenEstA.toString()}`,
      );
      assert.ok(
        quote.tokenEstB.eq(expectedTokenEstB),
        `tokenEstB: ${quote.tokenEstB.toString()} !== ${expectedTokenEstB.toString()}`,
      );
      assert.ok(
        quote.tokenMaxA.eq(expectedTokenMaxA),
        `tokenMaxA: ${quote.tokenMaxA.toString()} !== ${expectedTokenMaxA.toString()}`,
      );
      assert.ok(
        quote.tokenMaxB.eq(expectedTokenMaxB),
        `tokenMaxB: ${quote.tokenMaxB.toString()} !== ${expectedTokenMaxB.toString()}`,
      );
    }
  });
});

describe("edge cases for old slippage", () => {
  const tokenMintA = new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");
  const tokenMintB = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  it("sqrtPrice on lower bound, tokenB input", async () => {
    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenAmount: new BN(1000),
      inputTokenMint: tokenMintB,
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
      tokenMintA,
      tokenMintB,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.liquidityAmount.isZero());
    assert.ok(quote.tokenEstA.isZero());
    assert.ok(quote.tokenEstB.isZero());
    assert.ok(quote.tokenMaxA.isZero());
    assert.ok(quote.tokenMaxB.isZero());
  });

  it("sqrtPrice on lower bound, tokenA input", async () => {
    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenAmount: new BN(1000),
      inputTokenMint: tokenMintA,
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
      tokenMintA,
      tokenMintB,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.isZero());
    assert.ok(quote.tokenMaxA.gtn(0));
    assert.ok(quote.tokenMaxB.isZero());
  });

  it("tickCurrentIndex on lower bound but sqrtPrice not on lower bound, tokenA input", async () => {
    assert.ok(
      PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0)),
    );

    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenAmount: new BN(1000),
      inputTokenMint: tokenMintA,
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1).subn(1),
      tokenMintA,
      tokenMintB,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMaxA.gtn(0));
    assert.ok(quote.tokenMaxB.gtn(0));
  });

  it("tickCurrentIndex on lower bound but sqrtPrice not on lower bound, tokenB input", async () => {
    assert.ok(
      PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0)),
    );

    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenAmount: new BN(1000),
      inputTokenMint: tokenMintB,
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1).subn(1),
      tokenMintA,
      tokenMintB,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMaxA.gtn(0));
    assert.ok(quote.tokenMaxB.gtn(0));
  });

  it("sqrtPrice on upper bound, tokenA input", async () => {
    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenAmount: new BN(1000),
      inputTokenMint: tokenMintA,
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(64),
      tokenMintA,
      tokenMintB,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 64,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.liquidityAmount.isZero());
    assert.ok(quote.tokenEstA.isZero());
    assert.ok(quote.tokenEstB.isZero());
    assert.ok(quote.tokenMaxA.isZero());
    assert.ok(quote.tokenMaxB.isZero());
  });

  it("sqrtPrice on upper bound, tokenB input", async () => {
    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenAmount: new BN(1000),
      inputTokenMint: tokenMintB,
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(64),
      tokenMintA,
      tokenMintB,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 64,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.isZero());
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMaxA.isZero());
    assert.ok(quote.tokenMaxB.gtn(0));
  });
});

function getLiquidityFromInputToken(params: {
  inputTokenAmount: BN;
  isInputTokenA: boolean;
  currentTickIndex: number;
  sqrtPrice: BN;
  lowerTickIndex: number;
  upperTickIndex: number;
}) {
  const {
    inputTokenAmount,
    isInputTokenA,
    sqrtPrice,
    currentTickIndex,
    lowerTickIndex,
    upperTickIndex,
  } = params;

  const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(lowerTickIndex);
  const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(upperTickIndex);

  if (currentTickIndex >= upperTickIndex) {
    return isInputTokenA
      ? ZERO
      : getLiquidityFromTokenB(inputTokenAmount, lowerSqrtPrice, upperSqrtPrice, false);
  }

  if (currentTickIndex < lowerTickIndex) {
    return isInputTokenA
      ? getLiquidityFromTokenA(inputTokenAmount, lowerSqrtPrice, upperSqrtPrice, false)
      : ZERO;
  }

  return isInputTokenA
    ? getLiquidityFromTokenA(inputTokenAmount, sqrtPrice, upperSqrtPrice, false)
    : getLiquidityFromTokenB(inputTokenAmount, lowerSqrtPrice, sqrtPrice, false);
}
