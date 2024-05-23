import *  as assert from "assert";
import { PriceMath, decreaseLiquidityQuoteByLiquidityWithParams } from "../../../../src";
import { BN } from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { MintWithTokenProgram, Percentage } from "@orca-so/common-sdk";
import { NO_TOKEN_EXTENSION_CONTEXT, TokenExtensionContextForPool } from "../../../../src/utils/public/token-extension-util";
import { TEST_TOKEN_PROGRAM_ID } from "../../../utils";

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

    assert.ok(quote.tokenEstA.amount.gtn(0));
    assert.ok(quote.tokenEstB.amount.isZero());
    assert.ok(quote.tokenMinA.amount.gtn(0));
    assert.ok(quote.tokenMinB.amount.isZero());
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

    assert.ok(quote.tokenEstA.amount.gtn(0));
    assert.ok(quote.tokenEstB.amount.gtn(0));
    assert.ok(quote.tokenMinA.amount.gtn(0));
    assert.ok(quote.tokenMinB.amount.gtn(0));
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

    assert.ok(quote.tokenEstA.amount.isZero());
    assert.ok(quote.tokenEstB.amount.gtn(0));
    assert.ok(quote.tokenMinA.amount.isZero());
    assert.ok(quote.tokenMinB.amount.gtn(0));
  });

});
