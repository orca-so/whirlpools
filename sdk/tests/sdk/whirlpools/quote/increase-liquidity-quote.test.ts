import { Percentage, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import {
  PriceMath,
  increaseLiquidityQuoteByInputTokenWithParams,
  increaseLiquidityQuoteByInputTokenWithParams_PriceSlippage,
} from "../../../../src";
import {
  getLiquidityFromTokenA,
  getLiquidityFromTokenB,
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
} from "../../../../src/utils/position-util";

const variations = [
  [true, Percentage.fromFraction(0, 100)] as const,
  [false, Percentage.fromFraction(0, 100)] as const,
  [true, Percentage.fromFraction(1, 1000)] as const,
  [false, Percentage.fromFraction(1, 1000)] as const,
  [true, Percentage.fromFraction(1, 100)] as const,
  [false, Percentage.fromFraction(1, 100)] as const,
];
variations.forEach(([isTokenA, slippage]) => {
  describe("increaseLiquidityQuoteByInputToken_PriceSlippage", () => {
    const tokenMintA = new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");
    const tokenMintB = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    it("|[--------P--------]|", async () => testVariation({
      pTickLowerIndex: -202,
      pTickUpperIndex: 199,
      tickCurrentIndex: 0,
      inputTokenAmount: new BN(100000),
      isTokenA,
      slippage
    }));

    describe("Current price above range", () => {
      it("|----------------|  [---P---]", async () => testVariation({
        pTickLowerIndex: 205,
        pTickUpperIndex: 555,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("|--------------[--|--P----]", async () => testVariation({
        pTickLowerIndex: 100,
        pTickUpperIndex: 555,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[|---|---P------]", async () => testVariation({
        pTickLowerIndex: -202,
        pTickUpperIndex: 555,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[--|---|--P-------]", async () => testVariation({
        pTickLowerIndex: -100,
        pTickUpperIndex: 555,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));
    });

    describe("Current Price in range", () => {
      it("|-----[---P---]-----|", async () => testVariation({
        pTickLowerIndex: -100,
        pTickUpperIndex: 100,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[--|----P----]-----|", async () => testVariation({
        pTickLowerIndex: -300,
        pTickUpperIndex: 100,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("|--[---P---|-----]", async () => testVariation({
        pTickLowerIndex: -100,
        pTickUpperIndex: 300,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[---|---P---|----]", async () => testVariation({
        pTickLowerIndex: -300,
        pTickUpperIndex: 300,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));
    });

    describe("Current Price below range", () => {
      it("[---P---] |---------|", async () => testVariation({
        pTickLowerIndex: -500,
        pTickUpperIndex: -300,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[---P--|---]------|", async () => testVariation({
        pTickLowerIndex: -500,
        pTickUpperIndex: -100,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[-----P--|---|]", async () => testVariation({
        pTickLowerIndex: -500,
        pTickUpperIndex: 199,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));

      it("[-------P--|---|--]", async () => testVariation({
        pTickLowerIndex: -500,
        pTickUpperIndex: 300,
        tickCurrentIndex: 0,
        inputTokenAmount: new BN(100000),
        isTokenA,
        slippage
      }));
    });

    function testVariation(params: { pTickLowerIndex: number, pTickUpperIndex: number, tickCurrentIndex: number, inputTokenAmount: BN, isTokenA: boolean, slippage: Percentage }) {
      const { pTickLowerIndex, pTickUpperIndex, tickCurrentIndex, inputTokenAmount, isTokenA } = params;
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
        slippageTolerance: Percentage.fromFraction(1, 100),
      });

      // Expectations
      const { tokenEst: expectedTokenEstA, tokenMax: expectedTokenMaxA } =
        getTokenAForSlippageRange({
          inputTokenAmount,
          isInputTokenA: isTokenA,
          sqrtPrice,
          currentTickIndex: tickCurrentIndex,
          lowerTickIndex: pTickLowerIndex,
          upperTickIndex: pTickUpperIndex,
          slippage,
        });
      const { tokenEst: expectedTokenEstB, tokenMax: expectedTokenMaxB } =
        getTokenBForSlippageRange({
          inputTokenAmount,
          isInputTokenA: isTokenA,
          sqrtPrice,
          currentTickIndex: tickCurrentIndex,
          lowerTickIndex: pTickLowerIndex,
          upperTickIndex: pTickUpperIndex,
          slippage,
        });

      assert.ok(quote.tokenEstA.eq(expectedTokenEstA), `tokenEstA: ${quote.tokenEstA.toString()} !== ${expectedTokenEstA.toString()}`);
      assert.ok(quote.tokenEstB.eq(expectedTokenEstB), `tokenEstB: ${quote.tokenEstB.toString()} !== ${expectedTokenEstB.toString()}`);
      assert.ok(quote.tokenMaxA.eq(expectedTokenMaxA), `tokenMaxA: ${quote.tokenMaxA.toString()} !== ${expectedTokenMaxA.toString()}`);
      assert.ok(quote.tokenMaxB.eq(expectedTokenMaxB), `tokenMaxB: ${quote.tokenMaxB.toString()} !== ${expectedTokenMaxB.toString()}`);
    }
  });
});

function adjustPriceForSlippage(
  sqrtPrice: BN,
  slippageTolerance: Percentage,
  lowerBound: boolean
): { adjustedSqrtPrice: BN; adjustedTickCurrentIndex: number } {
  if (lowerBound) {
    const adjustedSqrtPrice = sqrtPrice
      .mul(slippageTolerance.denominator.sub(slippageTolerance.numerator))
      .div(slippageTolerance.denominator);
    const adjustedTickCurrentIndex = PriceMath.sqrtPriceX64ToTickIndex(adjustedSqrtPrice);
    return { adjustedSqrtPrice, adjustedTickCurrentIndex };
  }

  const adjustedSqrtPrice = sqrtPrice
    .mul(slippageTolerance.denominator.add(slippageTolerance.numerator))
    .div(slippageTolerance.denominator);
  const adjustedTickCurrentIndex = PriceMath.sqrtPriceX64ToTickIndex(adjustedSqrtPrice);
  return { adjustedSqrtPrice, adjustedTickCurrentIndex };
}

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
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.isZero());
    assert.ok(quote.tokenMaxA.gtn(0));
    assert.ok(quote.tokenMaxB.isZero());
  });

  it("tickCurrentIndex on lower bound but sqrtPrice not on lower bound, tokenA input", async () => {
    assert.ok(
      PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0))
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
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMaxA.gtn(0));
    assert.ok(quote.tokenMaxB.gtn(0));
  });

  it("tickCurrentIndex on lower bound but sqrtPrice not on lower bound, tokenB input", async () => {
    assert.ok(
      PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0))
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
    });

    assert.ok(quote.liquidityAmount.gtn(0));
    assert.ok(quote.tokenEstA.isZero());
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMaxA.isZero());
    assert.ok(quote.tokenMaxB.gtn(0));
  });
});



function getTokenExpectationsForSlippageRange(params: {
  inputTokenAmount: BN;
  isInputTokenA: boolean;
  sqrtPrice: BN;
  currentTickIndex: number;
  lowerTickIndex: number;
  upperTickIndex: number;
  slippage: Percentage;
}) {
  const { tokenEst: expectedTokenEstA, tokenMax: expectedTokenMaxA } =
    getTokenAForSlippageRange(params);
  const { tokenEst: expectedTokenEstB, tokenMax: expectedTokenMaxB } =
    getTokenBForSlippageRange(params);
  return {
    expectedTokenEstA,
    expectedTokenMaxA,
    expectedTokenEstB,
    expectedTokenMaxB,
  };
}

// Liquidity nees to be derived from the token amount and the current price
function getTokenAForSlippageRange(params: {
  inputTokenAmount: BN;
  isInputTokenA: boolean;
  sqrtPrice: BN;
  currentTickIndex: number;
  lowerTickIndex: number;
  upperTickIndex: number;
  slippage: Percentage;
}) {
  const { sqrtPrice, currentTickIndex, slippage } = params;
  const { adjustedSqrtPrice: sLowerSqrtPrice, adjustedTickCurrentIndex: sLowerIndex } =
    adjustPriceForSlippage(sqrtPrice, slippage, true);
  const { adjustedSqrtPrice: sUpperSqrtPrice, adjustedTickCurrentIndex: sUpperIndex } =
    adjustPriceForSlippage(sqrtPrice, slippage, false);

  const results = [
    getTokenEstA({
      ...params,
      sqrtPrice: sLowerSqrtPrice,
      currentTickIndex: sLowerIndex,
    }),
    getTokenEstA({
      ...params,
      sqrtPrice,
      currentTickIndex,
    }),
    getTokenEstA({
      ...params,
      sqrtPrice: sUpperSqrtPrice,
      currentTickIndex: sUpperIndex,
    }),
  ];

  return { tokenEst: results[1], tokenMax: results.reduce((a, b) => BN.max(a, b), ZERO) };
}

function getTokenEstA(params: {
  inputTokenAmount: BN;
  isInputTokenA: boolean;
  sqrtPrice: BN;
  currentTickIndex: number;
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
    return ZERO;
  }

  if (currentTickIndex < lowerTickIndex) {
    const liquidity = isInputTokenA
      ? getLiquidityFromTokenA(inputTokenAmount, lowerSqrtPrice, upperSqrtPrice, false)
      : ZERO;
    return getTokenAFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, true);
  }

  const liquidity = isInputTokenA
    ? getLiquidityFromTokenA(inputTokenAmount, sqrtPrice, upperSqrtPrice, false)
    : getLiquidityFromTokenB(inputTokenAmount, lowerSqrtPrice, sqrtPrice, false);
  return getTokenAFromLiquidity(liquidity, sqrtPrice, upperSqrtPrice, true);
}

function getTokenBForSlippageRange(params: {
  inputTokenAmount: BN;
  isInputTokenA: boolean;
  sqrtPrice: BN;
  currentTickIndex: number;
  lowerTickIndex: number;
  upperTickIndex: number;
  slippage: Percentage;
}) {
  const { sqrtPrice, currentTickIndex, slippage } = params;
  const { adjustedSqrtPrice: sLowerSqrtPrice, adjustedTickCurrentIndex: sLowerIndex } =
    adjustPriceForSlippage(sqrtPrice, slippage, true);
  const { adjustedSqrtPrice: sUpperSqrtPrice, adjustedTickCurrentIndex: sUpperIndex } =
    adjustPriceForSlippage(sqrtPrice, slippage, false);

  const results = [
    getTokenEstB({
      ...params,
      sqrtPrice: sLowerSqrtPrice,
      currentTickIndex: sLowerIndex,
    }),
    getTokenEstB({
      ...params,
      sqrtPrice,
      currentTickIndex,
    }),
    getTokenEstB({
      ...params,
      sqrtPrice: sUpperSqrtPrice,
      currentTickIndex: sUpperIndex,
    }),
  ];

  return { tokenEst: results[1], tokenMax: results.reduce((a, b) => BN.max(a, b), ZERO) };
}

function getTokenEstB(params: {
  inputTokenAmount: BN;
  isInputTokenA: boolean;
  sqrtPrice: BN;
  currentTickIndex: number;
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

  if (currentTickIndex < lowerTickIndex) {
    return ZERO;
  }

  if (currentTickIndex >= upperTickIndex) {
    const liquidity = isInputTokenA
      ? ZERO
      : getLiquidityFromTokenB(inputTokenAmount, lowerSqrtPrice, upperSqrtPrice, false);
    return getTokenBFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, true);
  }

  const liquidity = isInputTokenA
    ? getLiquidityFromTokenA(inputTokenAmount, sqrtPrice, upperSqrtPrice, false)
    : getLiquidityFromTokenB(inputTokenAmount, lowerSqrtPrice, sqrtPrice, false);
  return getTokenBFromLiquidity(liquidity, lowerSqrtPrice, sqrtPrice, true);
}