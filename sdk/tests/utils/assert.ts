import { deriveATA, ONE } from "@orca-so/common-sdk";
import { BN, Program, web3 } from "@project-serum/anchor";
import { AccountLayout, NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import { SwapQuote, WhirlpoolContext } from "../../src";
import { Whirlpool } from "../../src/artifacts/whirlpool";
import { DevFeeSwapQuote } from "../../src/quotes/public/dev-fee-swap-quote";
import { TickData, WhirlpoolData } from "../../src/types/public";
import { TEST_TOKEN_PROGRAM_ID } from "./test-consts";
import { getTokenBalance } from "./token";
import { VaultAmounts } from "./whirlpools-test-utils";

export function assertInputOutputQuoteEqual(
  inputTokenQuote: SwapQuote,
  outputTokenQuote: SwapQuote
) {
  assert.equal(inputTokenQuote.aToB, outputTokenQuote.aToB, "aToB not equal");
  // TODO: Sometimes input & output estimated In is off by 1. Same goes for sqrt-price
  assert.ok(
    inputTokenQuote.estimatedAmountIn.sub(outputTokenQuote.estimatedAmountIn).abs().lte(ONE),
    `input estimated In ${inputTokenQuote.estimatedAmountIn} does not equal output estimated in ${outputTokenQuote.estimatedAmountIn}`
  );
  assert.ok(
    inputTokenQuote.estimatedAmountOut.sub(outputTokenQuote.estimatedAmountOut).abs().lte(ONE),
    `input estimated out ${inputTokenQuote.estimatedAmountOut} does not equal output estimated out ${outputTokenQuote.estimatedAmountOut}`
  );
  assert.equal(
    inputTokenQuote.estimatedEndTickIndex,
    outputTokenQuote.estimatedEndTickIndex,
    "estimatedEndTickIndex not equal"
  );
  assert.equal(
    inputTokenQuote.estimatedFeeAmount.toString(),
    outputTokenQuote.estimatedFeeAmount.toString(),
    "estimatedFeeAmount not equal"
  );
  assert.notEqual(
    inputTokenQuote.amountSpecifiedIsInput,
    outputTokenQuote.amountSpecifiedIsInput,
    "amountSpecifiedIsInput equals"
  );
}

export function assertDevFeeQuotes(
  inputQuote: SwapQuote,
  postFeeInputQuote: SwapQuote,
  devFeeQuote: DevFeeSwapQuote
) {
  assert.equal(inputQuote.aToB, devFeeQuote.aToB, "aToB not equal");
  assert.ok(
    devFeeQuote.estimatedAmountIn.eq(inputQuote.estimatedAmountIn),
    `the devFeeQuote's estimatedAmountIn ${devFeeQuote.estimatedAmountIn} should equal the normal quote's estimatedAmountIn ${inputQuote.estimatedAmountIn}`
  );
  assert.ok(
    devFeeQuote.estimatedAmountIn.eq(
      postFeeInputQuote.estimatedAmountIn.add(devFeeQuote.devFeeAmount)
    ),
    `the devFeeQuote's estimatedAmountIn ${devFeeQuote.estimatedAmountIn} should equal the post-fee quote's estimatedAmountIn ${inputQuote.estimatedAmountIn} plus devFeeAmount ${devFeeQuote.devFeeAmount}`
  );
  assert.ok(
    postFeeInputQuote.estimatedAmountOut.sub(devFeeQuote.estimatedAmountOut).abs().lte(ONE),
    `post-fee input estimatedAmountOut ${inputQuote.estimatedAmountOut} does not equal devFee quote estimatedAmountOut - ${devFeeQuote.estimatedAmountOut}`
  );
  assert.equal(
    postFeeInputQuote.estimatedEndTickIndex,
    devFeeQuote.estimatedEndTickIndex,
    "estimatedEndTickIndex not equal"
  );
  assert.equal(
    devFeeQuote.estimatedFeeAmount.toString(),
    devFeeQuote.estimatedSwapFeeAmount.add(devFeeQuote.devFeeAmount).toString(),
    "devFeeQuote estimatedFeeAmount is not the sum of estimatedSwapFeeAmount and devFeeAmount"
  );
  assert.equal(
    devFeeQuote.estimatedSwapFeeAmount.toString(),
    postFeeInputQuote.estimatedFeeAmount.toString(),
    "devFeeQuote's estimatedSwapFeeAmount should equal the quote's total swap fee (without dev fee)"
  );
  assert.equal(
    postFeeInputQuote.amountSpecifiedIsInput,
    devFeeQuote.amountSpecifiedIsInput,
    "amountSpecifiedIsInput not equal"
  );
}

export async function assertDevTokenAmount(
  ctx: WhirlpoolContext,
  expectationQuote: DevFeeSwapQuote,
  swapToken: PublicKey,
  devWallet: PublicKey,
  preDevWalletLamport = 0
) {

  if (swapToken.equals(NATIVE_MINT)) {
    const walletAmount = await ctx.provider.connection.getBalance(devWallet);
    assert.equal(expectationQuote.devFeeAmount.toNumber() + preDevWalletLamport, walletAmount)
    return;
  }

  const tokenDevWalletAta = await deriveATA(devWallet, swapToken);
  const afterDevWalletAmount = await getTokenBalance(ctx.provider, tokenDevWalletAta);
  assert.equal(
    expectationQuote.devFeeAmount,
    afterDevWalletAmount,
    "incorrect devFee amount sent to dev wallet."
  );
}

export function assertQuoteAndResults(
  aToB: boolean,
  quote: SwapQuote,
  endData: WhirlpoolData,
  beforeVaultAmounts: VaultAmounts,
  afterVaultAmounts: VaultAmounts
) {
  const tokenADelta = beforeVaultAmounts.tokenA.sub(afterVaultAmounts.tokenA);
  const tokenBDelta = beforeVaultAmounts.tokenB.sub(afterVaultAmounts.tokenB);

  assert.equal(
    quote.estimatedAmountIn.toString(),
    (aToB ? tokenADelta : tokenBDelta).neg().toString()
  );
  assert.equal(quote.estimatedAmountOut.toString(), (aToB ? tokenBDelta : tokenADelta).toString());
  assert.equal(endData.tickCurrentIndex, quote.estimatedEndTickIndex);
  assert.equal(quote.estimatedEndSqrtPrice.toString(), endData.sqrtPrice.toString());
}

// Helper for token vault assertion checks.
export async function asyncAssertTokenVault(
  program: Program<Whirlpool>,
  tokenVaultPublicKey: web3.PublicKey,
  expectedValues: {
    expectedOwner: web3.PublicKey;
    expectedMint: web3.PublicKey;
  }
) {
  const tokenVault: web3.AccountInfo<Buffer> | null =
    await program.provider.connection.getAccountInfo(tokenVaultPublicKey);
  if (!tokenVault) {
    assert.fail(`token vault does not exist at ${tokenVaultPublicKey.toBase58()}`);
  }
  const tokenVaultAData = AccountLayout.decode(tokenVault.data);
  assert.ok(tokenVault.owner.equals(TEST_TOKEN_PROGRAM_ID));
  assert.ok(expectedValues.expectedOwner.equals(new web3.PublicKey(tokenVaultAData.owner)));
  assert.ok(expectedValues.expectedMint.equals(new web3.PublicKey(tokenVaultAData.mint)));
}

export function assertTick(
  tick: TickData,
  initialized: boolean,
  liquidityGross: BN,
  liquidityNet: BN
) {
  assert.ok(tick.initialized == initialized);
  assert.ok(tick.liquidityNet.eq(liquidityNet));
  assert.ok(tick.liquidityGross.eq(liquidityGross));
}
