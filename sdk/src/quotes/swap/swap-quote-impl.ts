import { Percentage, ZERO } from "@orca-so/common-sdk";
import { SwapQuoteParam, SwapQuote } from "../public";
import { BN } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { TickArraySequence } from "./tick-array-sequence";
import { simulateSwap } from "./swap-manager";
import { MAX_SQRT_PRICE, MAX_TICK_ARRAY_CROSSINGS, MIN_SQRT_PRICE } from "../../types/public";
import { SwapErrorCode, WhirlpoolsError } from "../../errors/errors";

/**
 * Figure out the quote parameters needed to successfully complete this trade on chain
 * @param param
 * @returns
 * @exceptions
 */
export function swapQuoteWithParamsImpl(params: SwapQuoteParam): SwapQuote {
  const {
    aToB,
    whirlpoolData,
    tickArrays,
    tokenAmount,
    sqrtPriceLimit,
    otherAmountThreshold,
    amountSpecifiedIsInput,
    slippageTolerance,
  } = params;

  if (sqrtPriceLimit.gt(new u64(MAX_SQRT_PRICE) || sqrtPriceLimit.lt(new u64(MIN_SQRT_PRICE)))) {
    throw new WhirlpoolsError(
      "Provided SqrtPriceLimit is out of bounds.",
      SwapErrorCode.SqrtPriceOutOfBounds
    );
  }

  if (
    (aToB && sqrtPriceLimit.gt(whirlpoolData.sqrtPrice)) ||
    (!aToB && sqrtPriceLimit.lt(whirlpoolData.sqrtPrice))
  ) {
    throw new WhirlpoolsError(
      "Provided SqrtPriceLimit is in the opposite direction of the trade.",
      SwapErrorCode.InvalidSqrtPriceLimitDirection
    );
  }

  if (tokenAmount.eq(ZERO)) {
    throw new WhirlpoolsError("Provided tokenAmount is zero.", SwapErrorCode.ZeroTradableAmount);
  }

  const tickSequence = new TickArraySequence(tickArrays, whirlpoolData.tickSpacing, aToB);

  // Ensure 1st search-index resides on the 1st array in the sequence to match smart contract expectation.
  if (!tickSequence.checkArrayContainsTickIndex(0, whirlpoolData.tickCurrentIndex)) {
    throw new WhirlpoolsError(
      "TickArray at index 0 does not contain the Whirlpool current tick index.",
      SwapErrorCode.TickArraySequenceInvalid
    );
  }

  const swapResults = simulateSwap(
    whirlpoolData,
    tickSequence,
    tokenAmount,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB
  );

  if (amountSpecifiedIsInput) {
    if (
      (aToB && otherAmountThreshold.gt(swapResults.amountB)) ||
      (!aToB && otherAmountThreshold.gt(swapResults.amountA))
    ) {
      throw new WhirlpoolsError(
        "Quoted amount for the other token is below the otherAmountThreshold.",
        SwapErrorCode.AmountOutBelowMinimum
      );
    }
  } else {
    if (
      (aToB && otherAmountThreshold.lt(swapResults.amountA)) ||
      (!aToB && otherAmountThreshold.lt(swapResults.amountA))
    ) {
      throw new WhirlpoolsError(
        "Quoted amount for the other token is above the otherAmountThreshold.",
        SwapErrorCode.AmountInAboveMaximum
      );
    }
  }

  const { estimatedAmountIn, estimatedAmountOut } = remapAndAdjustTokens(
    swapResults.amountA,
    swapResults.amountB,
    aToB,
    slippageTolerance
  );

  const numOfTickCrossings = tickSequence.getNumOfTouchedArrays() - 1;
  if (numOfTickCrossings > MAX_TICK_ARRAY_CROSSINGS) {
    throw new WhirlpoolsError(
      `Input amount causes the quote to traverse more than the allowable amount of tick-arrays ${numOfTickCrossings}`,
      SwapErrorCode.TickArrayCrossingAboveMax
    );
  }

  const touchedArrays = tickSequence.getTouchedArrays(MAX_TICK_ARRAY_CROSSINGS);

  return {
    estimatedAmountIn,
    estimatedAmountOut,
    estimatedEndTickIndex: swapResults.nextTickIndex,
    estimatedEndSqrtPrice: swapResults.nextSqrtPrice,
    estimatedFeeAmount: swapResults.totalFeeAmount,
    amount: tokenAmount,
    amountSpecifiedIsInput,
    aToB,
    otherAmountThreshold,
    sqrtPriceLimit,
    tickArray0: touchedArrays[0],
    tickArray1: touchedArrays[1],
    tickArray2: touchedArrays[2],
  };
}

/**
 *  TODO: Handle the slippage.
 *  */
function remapAndAdjustTokens(
  amountA: BN,
  amountB: BN,
  aToB: boolean,
  slippageTolerance: Percentage
) {
  const estimatedAmountIn = aToB ? amountA : amountB;
  const estimatedAmountOut = aToB ? amountB : amountA;
  return {
    estimatedAmountIn,
    estimatedAmountOut,
  };
}
