import { Percentage } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { AccountFetcher } from "../..";
import { SwapErrorCode, WhirlpoolsError } from "../../errors/errors";
import { Whirlpool } from "../../whirlpool-client";
import { BaseSwapQuote, swapQuoteByInputToken } from "./swap-quote";

/**
 * A collection of estimated values from quoting a swap with dev-fee collection.
 * @category Quotes
 * @param estimatedAmountIn - Approximate number of input token swapped in the swap
 * @param estimatedAmountOut - Approximate number of output token swapped in the swap
 * @param estimatedEndTickIndex - Approximate tick-index the Whirlpool will land on after this swap
 * @param estimatedEndSqrtPrice - Approximate sqrtPrice the Whirlpool will land on after this swap
 * @param estimatedFeeAmount - Approximate feeAmount (all fees) charged on this swap
 * @param estimatedSwapFeeAmount - Approximate feeAmount (LP + protocol fees) charged on this swap
 * @param devFeeAmount - Approximate feeAmount (developer fees) charged on this swap
 */
export type DevFeeSwapQuote = BaseSwapQuote & {
  amountSpecifiedIsInput: true;
  estimatedSwapFeeAmount: u64;
  devFeeAmount: u64;
};

/**
 * Get an estimated swap quote using input token amount.
 *
 * @category Quotes
 * @param whirlpool - Whirlpool to perform the swap on
 * @param inputTokenMint - PublicKey for the input token mint to swap with
 * @param tokenAmount - The amount of input token to swap from
 * @param slippageTolerance - The amount of slippage to account for in this quote
 * @param programId - PublicKey for the Whirlpool ProgramId
 * @param fetcher - AccountFetcher object to fetch solana accounts
 * @param refresh - If true, fetcher would default to fetching the latest accounts
 * @param devFeePercentage - The percentage amount to send to developer wallet prior to the swap. Percentage num/dem values has to match token decimal.
 * @returns a SwapQuote object with slippage adjusted SwapInput parameters & estimates on token amounts, fee & end whirlpool states.
 */
export async function swapQuoteByInputTokenWithDevFees(
  whirlpool: Whirlpool,
  inputTokenMint: Address,
  tokenAmount: u64,
  slippageTolerance: Percentage,
  programId: Address,
  fetcher: AccountFetcher,
  devFeePercentage: Percentage,
  refresh: boolean
): Promise<DevFeeSwapQuote> {
  if (devFeePercentage.toDecimal().greaterThanOrEqualTo(1)) {
    throw new WhirlpoolsError(
      "Provided devFeePercentage must be less than 100%",
      SwapErrorCode.InvalidDevFeePercentage
    );
  }

  const devFeeAmount = tokenAmount
    .mul(devFeePercentage.numerator)
    .div(devFeePercentage.denominator);

  const slippageAdjustedQuote = await swapQuoteByInputToken(
    whirlpool,
    inputTokenMint,
    tokenAmount.sub(devFeeAmount),
    slippageTolerance,
    programId,
    fetcher,
    refresh
  );

  const devFeeAdjustedQuote: DevFeeSwapQuote = {
    ...slippageAdjustedQuote,
    amountSpecifiedIsInput: true,
    estimatedAmountIn: slippageAdjustedQuote.estimatedAmountIn.add(devFeeAmount),
    estimatedFeeAmount: slippageAdjustedQuote.estimatedFeeAmount.add(devFeeAmount),
    estimatedSwapFeeAmount: slippageAdjustedQuote.estimatedFeeAmount,
    devFeeAmount,
  };

  return devFeeAdjustedQuote;
}
