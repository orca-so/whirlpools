import { Percentage, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import {
  PriceMath,
  increaseLiquidityQuoteByInputTokenWithParams,
  increaseLiquidityQuoteByInputTokenWithParams_PriceSlippage,
  increaseLiquidityQuoteByLiquidityWithParams,
} from "../../../../src";
import {
  getLiquidityFromTokenA,
  getLiquidityFromTokenB,
} from "../../../../src/utils/position-util";

const variations = [
  [true, Percentage.fromFraction(0, 100)] as const,
  [false, Percentage.fromFraction(0, 100)] as const,
  [true, Percentage.fromFraction(1, 1000)] as const,
  [false, Percentage.fromFraction(1, 1000)] as const,
  [true, Percentage.fromFraction(1, 100)] as const,
  [false, Percentage.fromFraction(1, 100)] as const,
];

// NOTE: Slippage range for current price (tick = 0) is [-101, 99]
variations.forEach(([isTokenA, slippage]) => {
  describe("increaseLiquidityQuoteByInputTokenUsingPriceSlippage", () => {
    const tokenMintA = new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");
    const tokenMintB = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    it("|[--------P--------]|", async () =>
      testVariation({
        pTickLowerIndex: -101,
        pTickUpperIndex: 99,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage,
      }));

    describe("Current price above range", () => {
      it("|----------------|  [---P---]", async () =>
        testVariation({
          pTickLowerIndex: 205,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("|--------------[--|--P----]", async () =>
        testVariation({
          pTickLowerIndex: 90,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[|---|---P------]", async () =>
        testVariation({
          pTickLowerIndex: -101,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[--|---|--P-------]", async () =>
        testVariation({
          pTickLowerIndex: -50,
          pTickUpperIndex: 555,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));
    });

    describe("Current Price in range", () => {
      it("|-----[---P---]-----|", async () =>
        testVariation({
          pTickLowerIndex: -55,
          pTickUpperIndex: 55,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[--|----P----]-----|", async () =>
        testVariation({
          pTickLowerIndex: -300,
          pTickUpperIndex: 55,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("|--[---P---|-----]", async () =>
        testVariation({
          pTickLowerIndex: -55,
          pTickUpperIndex: 300,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[---|---P---|----]", async () =>
        testVariation({
          pTickLowerIndex: -300,
          pTickUpperIndex: 55,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));
    });

    describe("Current Price below range", () => {
      it("[---P---] |---------|", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: -300,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[---P--|---]------|", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: -55,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[-----P--|---|]", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: 99,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));

      it("[-------P--|---|--]", async () =>
        testVariation({
          pTickLowerIndex: -500,
          pTickUpperIndex: 300,
          tickCurrentIndex: 0,
          inputTokenAmount: new BN(100000),
          isTokenA,
          slippage,
        }));
    });

    function testVariation(params: {
      pTickLowerIndex: number;
      pTickUpperIndex: number;
      tickCurrentIndex: number;
      inputTokenAmount: BN;
      isTokenA: boolean;
      slippage: Percentage;
    }) {
      const { pTickLowerIndex, pTickUpperIndex, tickCurrentIndex, inputTokenAmount, isTokenA } =
        params;
      const slippage = Percentage.fromFraction(1, 100);

      const sqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickCurrentIndex);

      const inputTokenMint = isTokenA ? tokenMintA : tokenMintB;

      const quote = increaseLiquidityQuoteByInputTokenWithParams_PriceSlippage({
        inputTokenAmount,
        inputTokenMint,
        sqrtPrice,
        tokenMintA,
        tokenMintB,
        tickLowerIndex: pTickLowerIndex,
        tickUpperIndex: pTickUpperIndex,
        tickCurrentIndex,
        slippage: Percentage.fromFraction(1, 100),
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
        slippage: slippage,
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
      slippage: Percentage.fromFraction(0, 100),
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
      slippage: Percentage.fromFraction(0, 100),
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
      slippage: Percentage.fromFraction(0, 100),
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
      slippage: Percentage.fromFraction(0, 100),
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
      slippage: Percentage.fromFraction(0, 100),
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
      slippage: Percentage.fromFraction(0, 100),
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
