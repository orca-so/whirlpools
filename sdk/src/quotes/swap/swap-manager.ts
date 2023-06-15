import { ZERO } from "@orca-so/common-sdk";
import BN from "bn.js";
import { PROTOCOL_FEE_RATE_MUL_VALUE, WhirlpoolData } from "../../types/public";
import { computeSwapStep } from "../../utils/math/swap-math";
import { PriceMath } from "../../utils/public";
import { TickArraySequence } from "./tick-array-sequence";

export type SwapResult = {
  amountA: BN;
  amountB: BN;
  nextTickIndex: number;
  nextSqrtPrice: BN;
  totalFeeAmount: BN;
};

export function computeSwap(
  whirlpoolData: WhirlpoolData,
  tickSequence: TickArraySequence,
  tokenAmount: BN,
  sqrtPriceLimit: BN,
  amountSpecifiedIsInput: boolean,
  aToB: boolean
): SwapResult {
  let amountRemaining = tokenAmount;
  let amountCalculated = ZERO;
  let currSqrtPrice = whirlpoolData.sqrtPrice;
  let currLiquidity = whirlpoolData.liquidity;
  let currTickIndex = whirlpoolData.tickCurrentIndex;
  let totalFeeAmount = ZERO;
  const feeRate = whirlpoolData.feeRate;
  const protocolFeeRate = whirlpoolData.protocolFeeRate;
  let currProtocolFee = new BN(0);
  let currFeeGrowthGlobalInput = aToB
    ? whirlpoolData.feeGrowthGlobalA
    : whirlpoolData.feeGrowthGlobalB;

  while (amountRemaining.gt(ZERO) && !sqrtPriceLimit.eq(currSqrtPrice)) {
    let { nextIndex: nextTickIndex } = tickSequence.findNextInitializedTickIndex(currTickIndex);

    let { nextTickPrice, nextSqrtPriceLimit: targetSqrtPrice } = getNextSqrtPrices(
      nextTickIndex,
      sqrtPriceLimit,
      aToB
    );

    const swapComputation = computeSwapStep(
      amountRemaining,
      feeRate,
      currLiquidity,
      currSqrtPrice,
      targetSqrtPrice,
      amountSpecifiedIsInput,
      aToB
    );

    totalFeeAmount = totalFeeAmount.add(swapComputation.feeAmount);

    if (amountSpecifiedIsInput) {
      amountRemaining = amountRemaining.sub(swapComputation.amountIn);
      amountRemaining = amountRemaining.sub(swapComputation.feeAmount);
      amountCalculated = amountCalculated.add(swapComputation.amountOut);
    } else {
      amountRemaining = amountRemaining.sub(swapComputation.amountOut);
      amountCalculated = amountCalculated.add(swapComputation.amountIn);
      amountCalculated = amountCalculated.add(swapComputation.feeAmount);
    }

    let { nextProtocolFee, nextFeeGrowthGlobalInput } = calculateFees(
      swapComputation.feeAmount,
      protocolFeeRate,
      currLiquidity,
      currProtocolFee,
      currFeeGrowthGlobalInput
    );
    currProtocolFee = nextProtocolFee;
    currFeeGrowthGlobalInput = nextFeeGrowthGlobalInput;

    if (swapComputation.nextPrice.eq(nextTickPrice)) {
      const nextTick = tickSequence.getTick(nextTickIndex);
      if (nextTick.initialized) {
        currLiquidity = calculateNextLiquidity(nextTick.liquidityNet, currLiquidity, aToB);
      }
      currTickIndex = aToB ? nextTickIndex - 1 : nextTickIndex;
    } else {
      currTickIndex = PriceMath.sqrtPriceX64ToTickIndex(swapComputation.nextPrice);
    }

    currSqrtPrice = swapComputation.nextPrice;
  }

  let { amountA, amountB } = calculateEstTokens(
    tokenAmount,
    amountRemaining,
    amountCalculated,
    aToB,
    amountSpecifiedIsInput
  );

  return {
    amountA,
    amountB,
    nextTickIndex: currTickIndex,
    nextSqrtPrice: currSqrtPrice,
    totalFeeAmount,
  };
}

function getNextSqrtPrices(nextTick: number, sqrtPriceLimit: BN, aToB: boolean) {
  const nextTickPrice = PriceMath.tickIndexToSqrtPriceX64(nextTick);
  const nextSqrtPriceLimit = aToB
    ? BN.max(sqrtPriceLimit, nextTickPrice)
    : BN.min(sqrtPriceLimit, nextTickPrice);
  return { nextTickPrice, nextSqrtPriceLimit };
}

function calculateFees(
  feeAmount: BN,
  protocolFeeRate: number,
  currLiquidity: BN,
  currProtocolFee: BN,
  currFeeGrowthGlobalInput: BN
) {
  let nextProtocolFee = currProtocolFee;
  let nextFeeGrowthGlobalInput = currFeeGrowthGlobalInput;
  let globalFee = feeAmount;

  if (protocolFeeRate > 0) {
    let delta = calculateProtocolFee(globalFee, protocolFeeRate);
    globalFee = globalFee.sub(delta);
    nextProtocolFee = nextProtocolFee.add(currProtocolFee);
  }

  if (currLiquidity.gt(ZERO)) {
    const globalFeeIncrement = globalFee.shln(64).div(currLiquidity);
    nextFeeGrowthGlobalInput = nextFeeGrowthGlobalInput.add(globalFeeIncrement);
  }

  return {
    nextProtocolFee,
    nextFeeGrowthGlobalInput,
  };
}

function calculateProtocolFee(globalFee: BN, protocolFeeRate: number) {
  return globalFee.mul(new BN(protocolFeeRate).div(PROTOCOL_FEE_RATE_MUL_VALUE));
}

function calculateEstTokens(
  amount: BN,
  amountRemaining: BN,
  amountCalculated: BN,
  aToB: boolean,
  amountSpecifiedIsInput: boolean
) {
  return aToB === amountSpecifiedIsInput
    ? {
        amountA: amount.sub(amountRemaining),
        amountB: amountCalculated,
      }
    : {
        amountA: amountCalculated,
        amountB: amount.sub(amountRemaining),
      };
}

function calculateNextLiquidity(tickNetLiquidity: BN, currLiquidity: BN, aToB: boolean) {
  return aToB ? currLiquidity.sub(tickNetLiquidity) : currLiquidity.add(tickNetLiquidity);
}
