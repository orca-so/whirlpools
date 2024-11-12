import BN from "bn.js";
import { FEE_RATE_MUL_VALUE } from "../../types/public";
import { BitMath } from "./bit-math";
import {
  getAmountDeltaA,
  getAmountDeltaB,
  getNextSqrtPrice,
  tryGetAmountDeltaA,
  tryGetAmountDeltaB,
} from "./token-math";

export type SwapStep = {
  amountIn: BN;
  amountOut: BN;
  nextPrice: BN;
  feeAmount: BN;
};

export function computeSwapStep(
  amountRemaining: BN,
  feeRate: number,
  currLiquidity: BN,
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  amountSpecifiedIsInput: boolean,
  aToB: boolean,
): SwapStep {
  let initialAmountFixedDelta = tryGetAmountFixedDelta(
    currSqrtPrice,
    targetSqrtPrice,
    currLiquidity,
    amountSpecifiedIsInput,
    aToB,
  );

  let amountCalc = amountRemaining;
  if (amountSpecifiedIsInput) {
    const result = BitMath.mulDiv(
      amountRemaining,
      FEE_RATE_MUL_VALUE.sub(new BN(feeRate)),
      FEE_RATE_MUL_VALUE,
      128,
    );
    amountCalc = result;
  }

  let nextSqrtPrice = initialAmountFixedDelta.lte(amountCalc)
    ? targetSqrtPrice
    : getNextSqrtPrice(
        currSqrtPrice,
        currLiquidity,
        amountCalc,
        amountSpecifiedIsInput,
        aToB,
      );

  let isMaxSwap = nextSqrtPrice.eq(targetSqrtPrice);

  let amountUnfixedDelta = getAmountUnfixedDelta(
    currSqrtPrice,
    nextSqrtPrice,
    currLiquidity,
    amountSpecifiedIsInput,
    aToB,
  );

  let amountFixedDelta =
    !isMaxSwap || initialAmountFixedDelta.exceedsMax()
      ? getAmountFixedDelta(
          currSqrtPrice,
          nextSqrtPrice,
          currLiquidity,
          amountSpecifiedIsInput,
          aToB,
        )
      : initialAmountFixedDelta.value();

  let amountIn = amountSpecifiedIsInput ? amountFixedDelta : amountUnfixedDelta;
  let amountOut = amountSpecifiedIsInput
    ? amountUnfixedDelta
    : amountFixedDelta;

  if (!amountSpecifiedIsInput && amountOut.gt(amountRemaining)) {
    amountOut = amountRemaining;
  }

  let feeAmount: BN;
  if (amountSpecifiedIsInput && !isMaxSwap) {
    feeAmount = amountRemaining.sub(amountIn);
  } else {
    const feeRateBN = new BN(feeRate);
    feeAmount = BitMath.mulDivRoundUp(
      amountIn,
      feeRateBN,
      FEE_RATE_MUL_VALUE.sub(feeRateBN),
      128,
    );
  }

  return {
    amountIn,
    amountOut,
    nextPrice: nextSqrtPrice,
    feeAmount,
  };
}

function getAmountFixedDelta(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  amountSpecifiedIsInput: boolean,
  aToB: boolean,
) {
  if (aToB === amountSpecifiedIsInput) {
    return getAmountDeltaA(
      currSqrtPrice,
      targetSqrtPrice,
      currLiquidity,
      amountSpecifiedIsInput,
    );
  } else {
    return getAmountDeltaB(
      currSqrtPrice,
      targetSqrtPrice,
      currLiquidity,
      amountSpecifiedIsInput,
    );
  }
}

function tryGetAmountFixedDelta(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  amountSpecifiedIsInput: boolean,
  aToB: boolean,
) {
  if (aToB === amountSpecifiedIsInput) {
    return tryGetAmountDeltaA(
      currSqrtPrice,
      targetSqrtPrice,
      currLiquidity,
      amountSpecifiedIsInput,
    );
  } else {
    return tryGetAmountDeltaB(
      currSqrtPrice,
      targetSqrtPrice,
      currLiquidity,
      amountSpecifiedIsInput,
    );
  }
}

function getAmountUnfixedDelta(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  amountSpecifiedIsInput: boolean,
  aToB: boolean,
) {
  if (aToB === amountSpecifiedIsInput) {
    return getAmountDeltaB(
      currSqrtPrice,
      targetSqrtPrice,
      currLiquidity,
      !amountSpecifiedIsInput,
    );
  } else {
    return getAmountDeltaA(
      currSqrtPrice,
      targetSqrtPrice,
      currLiquidity,
      !amountSpecifiedIsInput,
    );
  }
}
