import *  as assert from "assert";
import { PriceMath, increaseLiquidityQuoteByInputTokenWithParams } from "../../../../src";
import { BN } from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { MintWithTokenProgram, Percentage } from "@orca-so/common-sdk";
import { TEST_TOKEN_PROGRAM_ID } from "../../../utils";
import { NO_TOKEN_EXTENSION_CONTEXT, TokenExtensionContextForPool } from "../../../../src/utils/public/token-extension-util";

describe("edge cases", () => {
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
    assert.ok(PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0)));

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
    assert.ok(PriceMath.tickIndexToSqrtPriceX64(1).subn(1).gt(PriceMath.tickIndexToSqrtPriceX64(0)));

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
