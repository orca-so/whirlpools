import { BN } from "@coral-xyz/anchor";
import { ZERO } from "@orca-so/common-sdk";
import { SwapErrorCode, WhirlpoolsError } from "../../errors/errors";
import {
  MAX_SQRT_PRICE,
  MAX_SWAP_TICK_ARRAYS,
  MIN_SQRT_PRICE,
} from "../../types/public";
import type { SwapQuote, SwapQuoteParam } from "../public";
import { computeSwap } from "./swap-manager";
import { TickArraySequence } from "./tick-array-sequence";
import type { TransferFeeIncludedAmount } from "../../utils/public/token-extension-util";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";

/**
 * Figure out the quote parameters needed to successfully complete this trade on chain
 * @param param
 * @returns
 * @exceptions
 */
export function simulateSwap(params: SwapQuoteParam): SwapQuote {
  const {
    aToB,
    whirlpoolData,
    tickArrays,
    tokenAmount,
    sqrtPriceLimit,
    otherAmountThreshold,
    amountSpecifiedIsInput,
    timestampInSeconds: optionalTimestampInSeconds,
    oracleData,
    tokenExtensionCtx,
  } = params;

  if (
    sqrtPriceLimit.gt(new BN(MAX_SQRT_PRICE)) ||
    sqrtPriceLimit.lt(new BN(MIN_SQRT_PRICE))
  ) {
    throw new WhirlpoolsError(
      "Provided SqrtPriceLimit is out of bounds.",
      SwapErrorCode.SqrtPriceOutOfBounds,
    );
  }

  if (
    (aToB && sqrtPriceLimit.gte(whirlpoolData.sqrtPrice)) ||
    (!aToB && sqrtPriceLimit.lte(whirlpoolData.sqrtPrice))
  ) {
    throw new WhirlpoolsError(
      "Provided SqrtPriceLimit is in the opposite direction of the trade.",
      SwapErrorCode.InvalidSqrtPriceLimitDirection,
    );
  }

  if (tokenAmount.eq(ZERO)) {
    throw new WhirlpoolsError(
      "Provided tokenAmount is zero.",
      SwapErrorCode.ZeroTradableAmount,
    );
  }

  const tickSequence = new TickArraySequence(
    tickArrays,
    whirlpoolData.tickSpacing,
    aToB,
  );

  // Ensure 1st search-index resides on the 1st array in the sequence to match smart contract expectation.
  if (!tickSequence.isValidTickArray0(whirlpoolData.tickCurrentIndex)) {
    throw new WhirlpoolsError(
      "TickArray at index 0 does not contain the Whirlpool current tick index.",
      SwapErrorCode.TickArraySequenceInvalid,
    );
  }

  const adaptiveFeeInfo = !!oracleData
    ? {
        adaptiveFeeConstants: oracleData.adaptiveFeeConstants,
        adaptiveFeeVariables: oracleData.adaptiveFeeVariables,
      }
    : null;

  const timestampInSeconds =
    optionalTimestampInSeconds ?? new BN(Date.now()).div(new BN(1000));
  if (oracleData?.tradeEnableTimestamp.gt(timestampInSeconds)) {
    throw new WhirlpoolsError(
      "Trade is not enabled yet.",
      SwapErrorCode.TradeIsNotEnabled,
    );
  }

  if (amountSpecifiedIsInput) {
    // For ExactIn

    // computeSwap should be executed with "tokenAmount - transfer fee".
    const transferFeeExcludedIn =
      TokenExtensionUtil.calculateTransferFeeExcludedAmount(
        tokenAmount,
        aToB
          ? tokenExtensionCtx.tokenMintWithProgramA
          : tokenExtensionCtx.tokenMintWithProgramB,
        tokenExtensionCtx.currentEpoch,
      );

    if (transferFeeExcludedIn.amount.eq(ZERO)) {
      throw new WhirlpoolsError(
        "Provided tokenAmount is virtually zero due to transfer fee.",
        SwapErrorCode.ZeroTradableAmount,
      );
    }

    const swapResults = computeSwap(
      whirlpoolData,
      tickSequence,
      transferFeeExcludedIn.amount,
      sqrtPriceLimit,
      amountSpecifiedIsInput,
      aToB,
      timestampInSeconds,
      adaptiveFeeInfo,
    );

    // otherAmountThreshold should be applied to transfer fee EXCLUDED output amount.
    const transferFeeExcludedOut =
      TokenExtensionUtil.calculateTransferFeeExcludedAmount(
        aToB ? swapResults.amountB : swapResults.amountA,
        aToB
          ? tokenExtensionCtx.tokenMintWithProgramB
          : tokenExtensionCtx.tokenMintWithProgramA,
        tokenExtensionCtx.currentEpoch,
      );

    if (transferFeeExcludedOut.amount.lt(otherAmountThreshold)) {
      throw new WhirlpoolsError(
        "Quoted amount for the other token is below the otherAmountThreshold.",
        SwapErrorCode.AmountOutBelowMinimum,
      );
    }

    const fullfilled = (aToB ? swapResults.amountA : swapResults.amountB).eq(
      transferFeeExcludedIn.amount,
    );
    const transferFeeIncludedIn: TransferFeeIncludedAmount = fullfilled
      ? { amount: tokenAmount, fee: transferFeeExcludedIn.fee }
      : TokenExtensionUtil.calculateTransferFeeIncludedAmount(
          aToB ? swapResults.amountA : swapResults.amountB,
          aToB
            ? tokenExtensionCtx.tokenMintWithProgramA
            : tokenExtensionCtx.tokenMintWithProgramB,
          tokenExtensionCtx.currentEpoch,
        );

    const numOfTickCrossings = tickSequence.getNumOfTouchedArrays();
    if (numOfTickCrossings > MAX_SWAP_TICK_ARRAYS) {
      throw new WhirlpoolsError(
        `Input amount causes the quote to traverse more than the allowable amount of tick-arrays ${numOfTickCrossings}`,
        SwapErrorCode.TickArrayCrossingAboveMax,
      );
    }
    const touchedArrays = tickSequence.getTouchedArrays(MAX_SWAP_TICK_ARRAYS);

    return {
      estimatedAmountIn: transferFeeIncludedIn.amount,
      estimatedAmountOut: transferFeeExcludedOut.amount,
      estimatedEndTickIndex: swapResults.nextTickIndex,
      estimatedEndSqrtPrice: swapResults.nextSqrtPrice,
      estimatedFeeAmount: swapResults.totalFeeAmount,
      estimatedFeeRateMin: swapResults.appliedFeeRateMin,
      estimatedFeeRateMax: swapResults.appliedFeeRateMax,
      transferFee: {
        deductingFromEstimatedAmountIn: transferFeeIncludedIn.fee,
        deductedFromEstimatedAmountOut: transferFeeExcludedOut.fee,
      },
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

  // For ExactOut

  // For ExactOut, computeSwap should be executed with "tokenAmount + transfer fee".
  const transferFeeIncludedOut =
    TokenExtensionUtil.calculateTransferFeeIncludedAmount(
      tokenAmount,
      aToB
        ? tokenExtensionCtx.tokenMintWithProgramB
        : tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtx.currentEpoch,
    );

  const swapResults = computeSwap(
    whirlpoolData,
    tickSequence,
    transferFeeIncludedOut.amount,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    timestampInSeconds,
    adaptiveFeeInfo,
  );

  // otherAmountThreshold should be applied to transfer fee INCLUDED input amount.
  const transferFeeIncludedIn =
    TokenExtensionUtil.calculateTransferFeeIncludedAmount(
      aToB ? swapResults.amountA : swapResults.amountB,
      aToB
        ? tokenExtensionCtx.tokenMintWithProgramA
        : tokenExtensionCtx.tokenMintWithProgramB,
      tokenExtensionCtx.currentEpoch,
    );

  if (transferFeeIncludedIn.amount.gt(otherAmountThreshold)) {
    throw new WhirlpoolsError(
      "Quoted amount for the other token is above the otherAmountThreshold.",
      SwapErrorCode.AmountInAboveMaximum,
    );
  }

  const transferFeeExcludedOut =
    TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      aToB ? swapResults.amountB : swapResults.amountA,
      aToB
        ? tokenExtensionCtx.tokenMintWithProgramB
        : tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtx.currentEpoch,
    );

  const numOfTickCrossings = tickSequence.getNumOfTouchedArrays();
  if (numOfTickCrossings > MAX_SWAP_TICK_ARRAYS) {
    throw new WhirlpoolsError(
      `Input amount causes the quote to traverse more than the allowable amount of tick-arrays ${numOfTickCrossings}`,
      SwapErrorCode.TickArrayCrossingAboveMax,
    );
  }
  const touchedArrays = tickSequence.getTouchedArrays(MAX_SWAP_TICK_ARRAYS);

  return {
    estimatedAmountIn: transferFeeIncludedIn.amount,
    estimatedAmountOut: transferFeeExcludedOut.amount,
    estimatedEndTickIndex: swapResults.nextTickIndex,
    estimatedEndSqrtPrice: swapResults.nextSqrtPrice,
    estimatedFeeAmount: swapResults.totalFeeAmount,
    estimatedFeeRateMin: swapResults.appliedFeeRateMin,
    estimatedFeeRateMax: swapResults.appliedFeeRateMax,
    transferFee: {
      deductingFromEstimatedAmountIn: transferFeeIncludedIn.fee,
      deductedFromEstimatedAmountOut: transferFeeExcludedOut.fee,
    },
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
