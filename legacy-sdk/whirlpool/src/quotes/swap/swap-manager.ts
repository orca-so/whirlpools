import { U64_MAX, ZERO } from "@orca-so/common-sdk";
import BN from "bn.js";
import type { WhirlpoolData } from "../../types/public";
import { PROTOCOL_FEE_RATE_MUL_VALUE } from "../../types/public";
import { computeSwapStep } from "../../utils/math/swap-math";
import { PoolUtil, PriceMath } from "../../utils/public";
import type { TickArraySequence } from "./tick-array-sequence";
import { SwapErrorCode, WhirlpoolsError } from "../../errors/errors";
import { AdaptiveFeeInfo } from "../public";
import invariant from "tiny-invariant";
import { FeeRateManager } from "./fee-rate-manager";

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
  aToB: boolean,
  timestampInSeconds: BN,
  adaptiveFeeInfo: AdaptiveFeeInfo | null,
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

  invariant(PoolUtil.isInitializedWithAdaptiveFeeTier(whirlpoolData) === !!adaptiveFeeInfo, "adaptiveFeeInfo should be non-null if and only if the pool is initialized with adaptive fee tier");

  const feeRateManager = FeeRateManager.new(
    aToB,
    whirlpoolData.tickCurrentIndex,
    timestampInSeconds,
    feeRate,
    adaptiveFeeInfo,
  );

  while (amountRemaining.gt(ZERO) && !sqrtPriceLimit.eq(currSqrtPrice)) {
    let { nextIndex: nextTickIndex } =
      tickSequence.findNextInitializedTickIndex(currTickIndex);

    let { nextTickPrice: nextTickSqrtPrice, nextSqrtPriceLimit: sqrtPriceTarget } =
      getNextSqrtPrices(nextTickIndex, sqrtPriceLimit, aToB);

    do {
    feeRateManager.updateVolatilityAccumulator();

    const totalFeeRate = feeRateManager.getTotalFeeRate();
    const { boundedSqrtPriceTarget, adaptiveFeeUpdateSkipped } =
      feeRateManager.getBoundedSqrtPriceTarget(sqrtPriceTarget, currLiquidity);

    const swapComputation = computeSwapStep(
      amountRemaining,
      totalFeeRate,
      currLiquidity,
      currSqrtPrice,
      boundedSqrtPriceTarget,
      amountSpecifiedIsInput,
      aToB,
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

    if (amountRemaining.isNeg()) {
      throw new WhirlpoolsError(
        "Amount remaining is negative.",
        SwapErrorCode.AmountRemainingOverflow,
      );
    }
    if (amountCalculated.gt(U64_MAX)) {
      throw new WhirlpoolsError(
        "Amount calculated is greater than U64_MAX.",
        SwapErrorCode.AmountCalcOverflow,
      );
    }

    let { nextProtocolFee, nextFeeGrowthGlobalInput } = calculateFees(
      swapComputation.feeAmount,
      protocolFeeRate,
      currLiquidity,
      currProtocolFee,
      currFeeGrowthGlobalInput,
    );
    currProtocolFee = nextProtocolFee;
    currFeeGrowthGlobalInput = nextFeeGrowthGlobalInput;

    if (swapComputation.nextPrice.eq(nextTickSqrtPrice)) {
      const nextTick = tickSequence.getTick(nextTickIndex);
      if (nextTick.initialized) {
        currLiquidity = calculateNextLiquidity(
          nextTick.liquidityNet,
          currLiquidity,
          aToB,
        );
      }
      currTickIndex = aToB ? nextTickIndex - 1 : nextTickIndex;
    } else {
      currTickIndex = PriceMath.sqrtPriceX64ToTickIndex(
        swapComputation.nextPrice,
      );
    }

    currSqrtPrice = swapComputation.nextPrice;

    if (!adaptiveFeeUpdateSkipped) {
      feeRateManager.advanceTickGroup();
    } else {
      feeRateManager.advanceTickGroupAfterSkip(
        currSqrtPrice,
        nextTickSqrtPrice,
        nextTickIndex,
      );
    }

    } while (amountRemaining.gt(ZERO) && !currSqrtPrice.eq(sqrtPriceTarget));
  }

  let { amountA, amountB } = calculateEstTokens(
    tokenAmount,
    amountRemaining,
    amountCalculated,
    aToB,
    amountSpecifiedIsInput,
  );

  feeRateManager.updateMajorSwapTimestamp(whirlpoolData.sqrtPrice, currSqrtPrice);

  return {
    amountA,
    amountB,
    nextTickIndex: currTickIndex,
    nextSqrtPrice: currSqrtPrice,
    totalFeeAmount,
  };
}

function getNextSqrtPrices(
  nextTick: number,
  sqrtPriceLimit: BN,
  aToB: boolean,
) {
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
  currFeeGrowthGlobalInput: BN,
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
  return globalFee.mul(
    new BN(protocolFeeRate).div(PROTOCOL_FEE_RATE_MUL_VALUE),
  );
}

function calculateEstTokens(
  amount: BN,
  amountRemaining: BN,
  amountCalculated: BN,
  aToB: boolean,
  amountSpecifiedIsInput: boolean,
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

function calculateNextLiquidity(
  tickNetLiquidity: BN,
  currLiquidity: BN,
  aToB: boolean,
) {
  return aToB
    ? currLiquidity.sub(tickNetLiquidity)
    : currLiquidity.add(tickNetLiquidity);
}
