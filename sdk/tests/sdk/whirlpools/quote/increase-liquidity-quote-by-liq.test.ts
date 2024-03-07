import { Percentage, ZERO } from "@orca-so/common-sdk";
import assert from "assert";
import BN from "bn.js";
import { PriceMath, increaseLiquidityQuoteByLiquidityWithParams } from "../../../../src";
import {
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
} from "../../../../src/utils/position-util";

const variations = [
  [0, Percentage.fromFraction(1, 1000), new BN(17733543)] as const,
  [0, Percentage.fromFraction(1, 100), new BN(17733543)] as const,
  [0, Percentage.fromFraction(5, 100), new BN(17733543)] as const,
  [234653, Percentage.fromFraction(1, 1000), new BN(17733543)] as const,
  [234653, Percentage.fromFraction(1, 100), new BN(17733543)] as const,
  [234653, Percentage.fromFraction(5, 100), new BN(17733543)] as const,
  [-234653, Percentage.fromFraction(1, 1000), new BN(17733543)] as const,
  [-234653, Percentage.fromFraction(1, 100), new BN(17733543)] as const,
  [-234653, Percentage.fromFraction(5, 100), new BN(17733543)] as const,
];

function getTestSlipageRange(currIndex: number, slippage: Percentage) {
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

// [---P---] = P is the current price & [] is the slippage boundary
// |-------| = Position Boundary
variations.forEach(([currentTickIndex, slippage, liquidity]) => {
  describe("increaseLiquidityQuoteByLiquidity", () => {
    it(`|[--------P--------]| @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex,
        pTickUpperIndex: slippageRange.tickCurrentIndex,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`|----------------|  [---P---] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 200,
        pTickUpperIndex: slippageRange.tickLowerIndex - 100,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`|--------------[--|--P----] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 200,
        pTickUpperIndex: slippageRange.tickLowerIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[|---|---P------] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex,
        pTickUpperIndex: slippageRange.tickCurrentIndex - 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[--|---|--P-------] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex + 5,
        pTickUpperIndex: slippageRange.tickCurrentIndex - 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`|-----[---P---]-----| @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 200,
        pTickUpperIndex: slippageRange.tickUpperIndex + 200,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[--|----P----]-----| @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex + 5,
        pTickUpperIndex: slippageRange.tickUpperIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`|--[---P---|-----] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex - 125,
        pTickUpperIndex: slippageRange.tickCurrentIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[---|---P---|----] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickLowerIndex + 5,
        pTickUpperIndex: slippageRange.tickCurrentIndex + 5,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[---P---] |---------| @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickUpperIndex + 100,
        pTickUpperIndex: slippageRange.tickUpperIndex + 200,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[---P--|---]------| @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickCurrentIndex + 5,
        pTickUpperIndex: slippageRange.tickUpperIndex + 100,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[-----P--|---|] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickCurrentIndex + 5,
        pTickUpperIndex: slippageRange.tickUpperIndex,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    it(`[-------P--|---|--] @ tickCurrentIndex - ${currentTickIndex}, slippage - ${slippage.toDecimal()}%`, async () => {
      const slippageRange = getTestSlipageRange(currentTickIndex, slippage);
      testVariation({
        pTickLowerIndex: slippageRange.tickCurrentIndex + 2,
        pTickUpperIndex: slippageRange.tickUpperIndex - 2,
        tickCurrentIndex: slippageRange.tickCurrentIndex,
        liquidity,
        slippageTolerance: slippage,
      });
    });

    async function testVariation(params: {
      pTickLowerIndex: number;
      pTickUpperIndex: number;
      tickCurrentIndex: number;
      liquidity: BN;
      slippageTolerance: Percentage;
    }) {
      const { pTickLowerIndex, pTickUpperIndex, tickCurrentIndex, liquidity } = params;

      const sqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickCurrentIndex);

      const quote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity,
        sqrtPrice,
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex,
        slippageTolerance: params.slippageTolerance,
      });

      const {
        lowerBound: [sLowerSqrtPrice, sLowerIndex],
        upperBound: [sUpperSqrtPrice, sUpperIndex],
      } = PriceMath.getSlippageBoundForSqrtPrice(sqrtPrice, slippage);

      const upperTokenEstA = getTokenEstA({
        liquidity,
        sqrtPrice: sUpperSqrtPrice,
        currentTickIndex: sUpperIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });
      const upperTokenEstB = getTokenEstB({
        liquidity,
        sqrtPrice: sUpperSqrtPrice,
        currentTickIndex: sUpperIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });

      const lowerTokenEstA = getTokenEstA({
        liquidity,
        sqrtPrice: sLowerSqrtPrice,
        currentTickIndex: sLowerIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });
      const lowerTokenEstB = getTokenEstB({
        liquidity,
        sqrtPrice: sLowerSqrtPrice,
        currentTickIndex: sLowerIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });

      const expectedTokenMaxA = BN.max(
        BN.max(quote.tokenEstA, upperTokenEstA),
        lowerTokenEstA,
      );
      const expectedTokenMaxB = BN.max(
        BN.max(quote.tokenEstB, upperTokenEstB),
        lowerTokenEstB,
      );

      // Generate expectations for TokenEstA and TokenEstB
      const expectedTokenEstA = getTokenEstA({
        liquidity,
        sqrtPrice,
        currentTickIndex: tickCurrentIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });
      const expectedTokenEstB = getTokenEstB({
        liquidity,
        sqrtPrice,
        currentTickIndex: tickCurrentIndex,
        lowerTickIndex: pTickLowerIndex,
        upperTickIndex: pTickUpperIndex,
      });

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

function getTokenEstA(params: {
  liquidity: BN;
  sqrtPrice: BN;
  currentTickIndex: number;
  lowerTickIndex: number;
  upperTickIndex: number;
}) {
  const { liquidity, sqrtPrice, currentTickIndex, lowerTickIndex, upperTickIndex } = params;

  const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(lowerTickIndex);
  const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(upperTickIndex);

  if (currentTickIndex >= upperTickIndex) {
    return ZERO;
  }

  if (currentTickIndex < lowerTickIndex) {
    return getTokenAFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, true);
  }

  return getTokenAFromLiquidity(liquidity, sqrtPrice, upperSqrtPrice, true);
}

function getTokenEstB(params: {
  liquidity: BN;
  sqrtPrice: BN;
  currentTickIndex: number;
  lowerTickIndex: number;
  upperTickIndex: number;
}) {
  const { liquidity, sqrtPrice, currentTickIndex, lowerTickIndex, upperTickIndex } = params;

  const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(lowerTickIndex);
  const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(upperTickIndex);

  if (currentTickIndex < lowerTickIndex) {
    return ZERO;
  }

  if (currentTickIndex >= upperTickIndex) {
    return getTokenBFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, true);
  }

  return getTokenBFromLiquidity(liquidity, lowerSqrtPrice, sqrtPrice, true);
}
