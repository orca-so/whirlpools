import { Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import { DecreaseLiquidityQuoteParam, MAX_SQRT_PRICE_BN, MAX_TICK_INDEX, MIN_SQRT_PRICE_BN, MIN_TICK_INDEX, PriceMath, decreaseLiquidityQuoteByLiquidityWithParams, decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage } from "../../../../src";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../../src/utils/public/token-extension-util";

describe("edge cases", () => {
  const tokenMintA = new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");
  const tokenMintB = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  it("sqrtPrice on lower bound", async () => {
    const quote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new BN(100000),
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.isZero());
    assert.ok(quote.tokenMinA.gtn(0));
    assert.ok(quote.tokenMinB.isZero());
  });

  it("tickCurrentIndex on lower bound but sqrtPrice not on lower bound", async () => {
    assert.ok(PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0)));

    const quote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new BN(100000),
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1).subn(1),
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.tokenEstA.gtn(0));
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMinA.gtn(0));
    assert.ok(quote.tokenMinB.gtn(0));
  });

  it("sqrtPrice on upper bound", async () => {
    const quote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new BN(100000),
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(64),
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 64,
      slippageTolerance: Percentage.fromFraction(0, 100),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    });

    assert.ok(quote.tokenEstA.isZero());
    assert.ok(quote.tokenEstB.gtn(0));
    assert.ok(quote.tokenMinA.isZero());
    assert.ok(quote.tokenMinB.gtn(0));
  });

});

describe("decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage", () => {
  it("normal price, 1.5% slippage", () => {
    const params: DecreaseLiquidityQuoteParam = {
      liquidity: new BN(100000),
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1).subn(1),
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(15, 1000), //1.5%
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    }
    const quote = decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage(params);

    const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(params.sqrtPrice, params.slippageTolerance);

    const quoteAtPlusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: upperBound[0],
      tickCurrentIndex: upperBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const quoteAtMinusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: lowerBound[0],
      tickCurrentIndex: lowerBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const expectedTokenMinA = BN.min(BN.min(quote.tokenEstA, quoteAtPlusSlippage.tokenEstA), quoteAtMinusSlippage.tokenEstA);
    const expectedTokenMinB = BN.min(BN.min(quote.tokenEstB, quoteAtPlusSlippage.tokenEstB), quoteAtMinusSlippage.tokenEstB);

    assert.ok(quote.tokenMinA.eq(expectedTokenMinA));
    assert.ok(quote.tokenMinB.eq(expectedTokenMinB));
  });

  it("normal price, 0 slippage", () => {
    const params: DecreaseLiquidityQuoteParam = {
      liquidity: new BN(100000),
      sqrtPrice: PriceMath.tickIndexToSqrtPriceX64(1).subn(1),
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: 0,
      slippageTolerance: Percentage.fromFraction(0, 1000),
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    }
    const quote = decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage(params);

    const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(params.sqrtPrice, params.slippageTolerance);

    const quoteAtPlusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: upperBound[0],
      tickCurrentIndex: upperBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const quoteAtMinusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: lowerBound[0],
      tickCurrentIndex: lowerBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const expectedTokenMinA = BN.min(BN.min(quote.tokenEstA, quoteAtPlusSlippage.tokenEstA), quoteAtMinusSlippage.tokenEstA);
    const expectedTokenMinB = BN.min(BN.min(quote.tokenEstB, quoteAtPlusSlippage.tokenEstB), quoteAtMinusSlippage.tokenEstB);

    assert.ok(quote.tokenMinA.eq(expectedTokenMinA));
    assert.ok(quote.tokenMinB.eq(expectedTokenMinB));
  });


  it("at MAX_PRICE, slippage at 1.5%", () => {
    const params: DecreaseLiquidityQuoteParam = {
      liquidity: new BN(100000),
      sqrtPrice: MAX_SQRT_PRICE_BN,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: MAX_TICK_INDEX,
      slippageTolerance: Percentage.fromFraction(15, 1000), //1.5%
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    }
    const quote = decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage(params);

    const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(params.sqrtPrice, params.slippageTolerance);

    const quoteAtPlusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: upperBound[0],
      tickCurrentIndex: upperBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const quoteAtMinusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: lowerBound[0],
      tickCurrentIndex: lowerBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const expectedTokenMinA = BN.min(BN.min(quote.tokenEstA, quoteAtPlusSlippage.tokenEstA), quoteAtMinusSlippage.tokenEstA);
    const expectedTokenMinB = BN.min(BN.min(quote.tokenEstB, quoteAtPlusSlippage.tokenEstB), quoteAtMinusSlippage.tokenEstB);

    assert.ok(quote.tokenMinA.eq(expectedTokenMinA));
    assert.ok(quote.tokenMinB.eq(expectedTokenMinB));
  })

  it("at MIN_PRICE, slippage at 1.5%", () => {
    const params: DecreaseLiquidityQuoteParam = {
      liquidity: new BN(100000),
      sqrtPrice: MIN_SQRT_PRICE_BN,
      tickLowerIndex: 0,
      tickUpperIndex: 64,
      tickCurrentIndex: MIN_TICK_INDEX,
      slippageTolerance: Percentage.fromFraction(15, 1000), //1.5%
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // TokenExtension is not related to this test
    }
    const quote = decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage(params);

    const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(params.sqrtPrice, params.slippageTolerance);

    const quoteAtPlusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: upperBound[0],
      tickCurrentIndex: upperBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const quoteAtMinusSlippage = decreaseLiquidityQuoteByLiquidityWithParams({
      ...params,
      sqrtPrice: lowerBound[0],
      tickCurrentIndex: lowerBound[1],
      slippageTolerance: Percentage.fromFraction(0, 1000)
    })

    const expectedTokenMinA = BN.min(BN.min(quoteAtMinusSlippage.tokenEstA, quoteAtPlusSlippage.tokenEstA), quoteAtMinusSlippage.tokenEstA);
    const expectedTokenMinB = BN.min(BN.min(quoteAtMinusSlippage.tokenEstB, quoteAtPlusSlippage.tokenEstB), quoteAtMinusSlippage.tokenEstB);

    assert.ok(quote.tokenMinA.eq(expectedTokenMinA));
    assert.ok(quote.tokenMinB.eq(expectedTokenMinB));
  })

});