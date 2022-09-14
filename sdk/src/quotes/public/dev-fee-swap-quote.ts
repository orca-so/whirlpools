import { AddressUtil, Percentage } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import invariant from "tiny-invariant";
import { AccountFetcher } from "../..";
import { SwapErrorCode, WhirlpoolsError } from "../../errors/errors";
import { PoolUtil, SwapUtils, TokenType } from "../../utils/public";
import { Whirlpool } from "../../whirlpool-client";
import { simulateSwap } from "../swap/swap-quote-impl";
import { checkIfAllTickArraysInitialized } from "../swap/swap-quote-utils";
import { BaseSwapQuote, SwapQuote, SwapQuoteParam } from "./swap-quote";

/**
 * @category Quotes
 *
 * @param tokenAmount - The amount of input or output token to swap from (depending on amountSpecifiedIsInput).
 * @param otherAmountThreshold - The maximum/minimum of input/output token to swap into (depending on amountSpecifiedIsInput).
 * @param sqrtPriceLimit - The maximum/minimum price the swap will swap to.
 * @param aToB - The direction of the swap. True if swapping from A to B. False if swapping from B to A.
 * @param amountSpecifiedIsInput - 'true', dev-fee swaps only supports where tokenAmount specified is the input.
 * @param tickArrays - An sequential array of tick-array objects in the direction of the trade to swap on
 * @param devFeePercentage - The percentage of fees the developer will collect from this swap. Percentage value has to match the input token decimals.
 */
export type DevFeeSwapQuoteParam = SwapQuoteParam & {
  devFeePercentage: Percentage;
  amountSpecifiedIsInput: true;
};

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
  estimatedSwapFeeAmount: u64;
  devFeeAmount: u64;
  amountSpecifiedIsInput: true;
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
  const whirlpoolData = whirlpool.getData();
  const swapMintKey = AddressUtil.toPubKey(inputTokenMint);
  const swapTokenType = PoolUtil.getTokenType(whirlpoolData, swapMintKey);
  invariant(!!swapTokenType, "swapTokenMint does not match any tokens on this pool");
  const aToB = swapTokenType === TokenType.TokenA;

  const tickArrays = await SwapUtils.getTickArrays(
    whirlpoolData.tickCurrentIndex,
    whirlpoolData.tickSpacing,
    aToB,
    AddressUtil.toPubKey(programId),
    whirlpool.getAddress(),
    fetcher,
    refresh
  );

  return devFeeSwapQuoteWithParams(
    {
      whirlpoolData,
      tokenAmount,
      aToB,
      amountSpecifiedIsInput: true,
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      tickArrays,
      devFeePercentage,
    },
    slippageTolerance
  );
}

/**
 * Perform a sync swap quote based on the basic swap instruction parameters.
 *
 * @category Quotes
 * @param params - SwapQuote parameters
 * @param slippageTolerance - The amount of slippage to account for when generating the final quote.
 * @returns a SwapQuote object with slippage adjusted SwapInput parameters & estimates on token amounts, fee & end whirlpool states.
 */
export function devFeeSwapQuoteWithParams(
  params: DevFeeSwapQuoteParam,
  slippageTolerance: Percentage
): DevFeeSwapQuote {
  checkIfAllTickArraysInitialized(params.tickArrays);

  if (params.devFeePercentage.toDecimal().greaterThanOrEqualTo(1)) {
    throw new WhirlpoolsError(
      "Provided devFeePercentage must be less than 100%",
      SwapErrorCode.InvalidDevFeePercentage
    );
  }

  const devFeeRate = params.devFeePercentage;
  const devFeeAmount = params.tokenAmount.mul(devFeeRate.numerator).div(devFeeRate.denominator);
  const finalTokenAmount = params.tokenAmount.sub(devFeeAmount);

  const quote = simulateSwap({
    ...params,
    tokenAmount: finalTokenAmount,
  });

  const slippageAdjustedQuote: SwapQuote = {
    ...quote,
    ...SwapUtils.calculateSwapAmountsFromQuote(
      quote.amount,
      quote.estimatedAmountIn,
      quote.estimatedAmountOut,
      slippageTolerance,
      quote.amountSpecifiedIsInput
    ),
  };

  const devFeeAdjustedQuote: DevFeeSwapQuote = {
    ...slippageAdjustedQuote,
    estimatedAmountIn: quote.estimatedAmountIn.add(devFeeAmount),
    amountSpecifiedIsInput: true,
    estimatedFeeAmount: quote.estimatedFeeAmount.add(devFeeAmount),
    estimatedSwapFeeAmount: quote.estimatedFeeAmount,
    devFeeAmount,
  };

  return devFeeAdjustedQuote;
}
