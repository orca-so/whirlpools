import * as assert from "assert";
import { Program, web3, BN } from "@project-serum/anchor";
import { AccountLayout } from "@solana/spl-token";
import { TEST_TOKEN_PROGRAM_ID } from "./test-consts";
import { Whirlpool } from "../../src/artifacts/whirlpool";
import { TickData, WhirlpoolData } from "../../src/types/public";
import { SwapQuote } from "../../src";
import { VaultAmounts } from "./whirlpools-test-utils";
import { ONE } from "@orca-so/common-sdk";

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
