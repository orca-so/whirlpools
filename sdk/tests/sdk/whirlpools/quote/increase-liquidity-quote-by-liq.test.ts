import { Percentage, ZERO } from "@orca-so/common-sdk";
import assert from "assert";
import BN from "bn.js";
import {
  PriceMath,
  increaseLiquidityQuoteByLiquidityWithParams
} from "../../../../src";
import {
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
} from "../../../../src/utils/position-util";

const variations = [
  [Percentage.fromFraction(0, 100), new BN(17733543)] as const,
  [Percentage.fromFraction(1, 1000), new BN(17733543)] as const,
  [Percentage.fromFraction(1, 100), new BN(17733543)] as const,
];

variations.forEach(([slippage, liquidity]) => {
  describe("increaseLiquidityQuoteByLiquidity", () => {
    it("|[--------P--------]|", async () =>
      testVariation({
        pTickLowerIndex: -101,
        pTickUpperIndex: 99,
        tickCurrentIndex: 0,
        liquidity,
        slippage,
      }));

    describe("Current price above range", () => {
      it("|----------------|  [---P---]", async () =>
        testVariation({
          pTickLowerIndex: 205,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("|--------------[--|--P----]", async () =>
        testVariation({
          pTickLowerIndex: 90,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[|---|---P------]", async () =>
        testVariation({
          pTickLowerIndex: -101,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[--|---|--P-------]", async () =>
        testVariation({
          pTickLowerIndex: -50,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));
    });

    describe("Current Price in range", () => {
      it("|-----[---P---]-----|", async () =>
        testVariation({
          pTickLowerIndex: -55,
          pTickUpperIndex: 55,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[--|----P----]-----|", async () =>
        testVariation({
          pTickLowerIndex: -300,
          pTickUpperIndex: 55,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("|--[---P---|-----]", async () =>
        testVariation({
          pTickLowerIndex: -55,
          pTickUpperIndex: 300,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[---|---P---|----]", async () =>
        testVariation({
          pTickLowerIndex: -300,
          pTickUpperIndex: 55,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));
    });

    describe("Current Price below range", () => {
      it("[---P---] |---------|", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: -300,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[---P--|---]------|", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: -55,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[-----P--|---|]", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: 99,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));

      it("[-------P--|---|--]", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: 300,
          tickCurrentIndex: 0,
          liquidity,
          slippage,
        }));
    });

    async function testVariation(params: {
      pTickLowerIndex: number;
      pTickUpperIndex: number;
      tickCurrentIndex: number;
      liquidity: BN;
      slippage: Percentage;
    }) {
      const { pTickLowerIndex, pTickUpperIndex, tickCurrentIndex, liquidity } = params;

      const sqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickCurrentIndex);

      const quote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity,
        sqrtPrice,
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex,
        slippage,
      });

      const {
        lowerBound: [sLowerSqrtPrice, sLowerIndex],
        upperBound: [sUpperSqrtPrice, sUpperIndex],
      } = PriceMath.getSlippageBoundForSqrtPrice(sqrtPrice, slippage);

      const upperQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity,
        sqrtPrice: sUpperSqrtPrice,
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex: sUpperIndex,
        slippage: Percentage.fromFraction(0, 100),
      });

      const lowerQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity,
        sqrtPrice: sLowerSqrtPrice,
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex: sLowerIndex,
        slippage: Percentage.fromFraction(0, 100),
      });

      const expectedTokenMaxA = BN.max(
        BN.max(quote.tokenEstA, upperQuote.tokenEstA),
        lowerQuote.tokenEstA,
      );
      const expectedTokenMaxB = BN.max(
        BN.max(quote.tokenEstB, upperQuote.tokenEstB),
        lowerQuote.tokenEstB,
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

  const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(upperTickIndex);

  if (currentTickIndex >= upperTickIndex) {
    return ZERO;
  }

  if (currentTickIndex < lowerTickIndex) {
    return getTokenAFromLiquidity(liquidity, sqrtPrice, upperSqrtPrice, true);
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
