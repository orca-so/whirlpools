import { Address, BN } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { u64 } from "@solana/spl-token";
import invariant from "tiny-invariant";
import { PoolUtil } from "../../utils/public/pool-utils";
import {
  SwapDirection,
  AmountSpecified,
  adjustAmountForSlippage,
  getAmountFixedDelta,
  getNextSqrtPrice,
  getAmountUnfixedDelta,
} from "../../utils/position-util";
import { SwapInput } from "../../instructions";
import {
  WhirlpoolData,
  TickArrayData,
  MAX_TICK_ARRAY_CROSSINGS,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  TICK_ARRAY_SIZE,
} from "../../types/public";
import { AddressUtil, MathUtil, Percentage, ZERO } from "@orca-so/common-sdk";
import { PriceMath, TickArrayUtil, TickUtil } from "../../utils/public";
import { Whirlpool } from "../../whirlpool-client";
import { AccountFetcher } from "../../network/public";

/**
 * @category Quotes
 */
export type SwapQuoteParam = {
  whirlpoolData: WhirlpoolData;
  tokenAmount: u64;
  aToB: boolean;
  amountSpecifiedIsInput: boolean;
  slippageTolerance: Percentage;
  tickArrayAddresses: PublicKey[];
  tickArrays: (TickArrayData | null)[];
};

/**
 * @category Quotes
 */
export type SwapQuote = {
  estimatedAmountIn: u64;
  estimatedAmountOut: u64;
} & SwapInput;

export async function swapQuoteByInputToken(
  whirlpool: Whirlpool,
  swapTokenMint: Address,
  tokenAmount: u64,
  amountSpecifiedIsInput: boolean,
  slippageTolerance: Percentage,
  fetcher: AccountFetcher,
  programId: Address,
  refresh: boolean
): Promise<SwapQuote> {
  const whirlpoolData = whirlpool.getData();
  const swapMintKey = AddressUtil.toPubKey(swapTokenMint);
  const swapTokenType = PoolUtil.getTokenType(whirlpoolData, swapMintKey);
  invariant(!!swapTokenType, "swapTokenMint does not match any tokens on this pool");

  const aToB =
    swapMintKey.equals(whirlpoolData.tokenMintA) === amountSpecifiedIsInput ? true : false;

  const tickArrayAddresses = PoolUtil.getTickArrayPublicKeysForSwap(
    whirlpoolData.tickCurrentIndex,
    whirlpoolData.tickSpacing,
    aToB,
    AddressUtil.toPubKey(programId),
    whirlpool.getAddress()
  );
  const tickArrays = await fetcher.listTickArrays(tickArrayAddresses, refresh);

  // Check if all the tick arrays have been initialized.
  const uninitializedIndices = TickArrayUtil.getUninitializedArrays(tickArrays);
  if (uninitializedIndices.length > 0) {
    const uninitializedArrays = uninitializedIndices
      .map((index) => tickArrayAddresses[index].toBase58())
      .join(", ");
    throw new Error(`TickArray addresses - [${uninitializedArrays}] need to be initialized.`);
  }

  return swapQuoteWithParams({
    whirlpoolData,
    tokenAmount,
    aToB,
    amountSpecifiedIsInput,
    slippageTolerance,
    tickArrayAddresses,
    tickArrays,
  });
}

/**
 * TODO: Bug - The quote swap loop will ignore the first initialized tick of the next array on array traversal
 * if the tick is on offset 0.
 * TODO: Build out a comprhensive integ test-suite for all tick traversal. The test suite would confirm
 * edge cases for both smart-contract and quote (they must equal). The original test-cases in SDK can be ported
 * over in this effort.
 * TODO: Think about other types of quote that we want to write (ex. limit by price to get trade amount etc)
 *
 * Get an estimated quote of a swap
 *
 * @category Quotes
 * @param param a SwapQuoteParam object detailing parameters of the swap
 * @return a SwapQuote on the estimated amountIn & amountOut of the swap and a SwapInput to use on the swap instruction.
 */
export function swapQuoteWithParams(param: SwapQuoteParam): SwapQuote {
  const {
    aToB,
    tokenAmount,
    whirlpoolData,
    amountSpecifiedIsInput,
    slippageTolerance,
    tickArrays,
    tickArrayAddresses,
  } = param;

  const swapDirection = aToB ? SwapDirection.AtoB : SwapDirection.BtoA;
  const amountSpecified = amountSpecifiedIsInput ? AmountSpecified.Input : AmountSpecified.Output;

  const { amountIn, amountOut, sqrtPriceLimitX64, tickArraysCrossed } = simulateSwap(
    {
      whirlpoolData,
      amountSpecified,
      swapDirection,
      tickArrays,
    },
    {
      amount: tokenAmount,
      currentSqrtPriceX64: whirlpoolData.sqrtPrice,
      currentTickIndex: whirlpoolData.tickCurrentIndex,
      currentLiquidity: whirlpoolData.liquidity,
    }
  );

  const otherAmountThreshold = adjustAmountForSlippage(
    amountIn,
    amountOut,
    slippageTolerance,
    amountSpecified
  );

  // Compute the traversed set of tick-arrays. Set the remaining slots to
  //the last traversed array.
  const traversedTickArrays = tickArrayAddresses.map((addr, index) => {
    if (index < tickArraysCrossed) {
      return addr;
    }
    return tickArrayAddresses[Math.max(tickArraysCrossed - 1, 0)];
  });

  return {
    amount: tokenAmount,
    otherAmountThreshold,
    sqrtPriceLimit: sqrtPriceLimitX64,
    estimatedAmountIn: amountIn,
    estimatedAmountOut: amountOut,
    aToB: swapDirection === SwapDirection.AtoB,
    amountSpecifiedIsInput,
    tickArray0: traversedTickArrays[0],
    tickArray1: traversedTickArrays[1],
    tickArray2: traversedTickArrays[2],
  };
}

type SwapSimulationBaseInput = {
  whirlpoolData: WhirlpoolData;
  amountSpecified: AmountSpecified;
  swapDirection: SwapDirection;
  tickArrays: (TickArrayData | null)[];
};

type SwapSimulationInput = {
  amount: BN;
  currentSqrtPriceX64: BN;
  currentTickIndex: number;
  currentLiquidity: BN;
};

type SwapSimulationOutput = {
  amountIn: BN;
  amountOut: BN;
  sqrtPriceLimitX64: BN;
  tickArraysCrossed: number;
};

type SwapStepSimulationInput = {
  sqrtPriceX64: BN;
  tickIndex: number;
  liquidity: BN;
  amountRemaining: u64;
  tickArraysCrossed: number;
};

type SwapStepSimulationOutput = {
  nextSqrtPriceX64: BN;
  nextTickIndex: number;
  input: BN;
  output: BN;
  tickArraysCrossed: number;
  hasReachedNextTick: boolean;
};

function simulateSwap(
  baseInput: SwapSimulationBaseInput,
  input: SwapSimulationInput
): SwapSimulationOutput {
  const { amountSpecified, swapDirection } = baseInput;

  let {
    currentTickIndex,
    currentLiquidity,
    amount: specifiedAmountLeft,
    currentSqrtPriceX64,
  } = input;

  invariant(!specifiedAmountLeft.eq(ZERO), "amount must be nonzero");

  let otherAmountCalculated = ZERO;

  let tickArraysCrossed = 0;
  let sqrtPriceLimitX64;

  while (specifiedAmountLeft.gt(ZERO)) {
    if (tickArraysCrossed > MAX_TICK_ARRAY_CROSSINGS) {
      throw Error("Crossed the maximum number of tick arrays");
    }

    const swapStepSimulationOutput: SwapStepSimulationOutput = simulateSwapStep(baseInput, {
      sqrtPriceX64: currentSqrtPriceX64,
      amountRemaining: specifiedAmountLeft,
      tickIndex: currentTickIndex,
      liquidity: currentLiquidity,
      tickArraysCrossed,
    });

    const { input, output, nextSqrtPriceX64, nextTickIndex, hasReachedNextTick } =
      swapStepSimulationOutput;

    const [specifiedAmountUsed, otherAmount] = resolveTokenAmounts(input, output, amountSpecified);

    specifiedAmountLeft = specifiedAmountLeft.sub(specifiedAmountUsed);
    otherAmountCalculated = otherAmountCalculated.add(otherAmount);

    if (hasReachedNextTick) {
      const nextTick = fetchTick(baseInput, nextTickIndex);

      currentLiquidity = calculateNewLiquidity(
        currentLiquidity,
        nextTick.liquidityNet,
        swapDirection
      );

      currentTickIndex = swapDirection == SwapDirection.AtoB ? nextTickIndex - 1 : nextTickIndex;
    }

    currentSqrtPriceX64 = nextSqrtPriceX64;
    tickArraysCrossed = swapStepSimulationOutput.tickArraysCrossed;

    if (tickArraysCrossed > MAX_TICK_ARRAY_CROSSINGS) {
      sqrtPriceLimitX64 = PriceMath.tickIndexToSqrtPriceX64(nextTickIndex);
    }
  }

  const [inputAmount, outputAmount] = resolveTokenAmounts(
    input.amount.sub(specifiedAmountLeft),
    otherAmountCalculated,
    amountSpecified
  );

  if (!sqrtPriceLimitX64) {
    if (swapDirection === SwapDirection.AtoB) {
      sqrtPriceLimitX64 = new BN(MIN_SQRT_PRICE);
    } else {
      sqrtPriceLimitX64 = new BN(MAX_SQRT_PRICE);
    }
  }

  // Return sqrtPriceLimit if 3 tick arrays crossed
  return {
    amountIn: inputAmount,
    amountOut: outputAmount,
    sqrtPriceLimitX64,
    tickArraysCrossed,
  };
}

function simulateSwapStep(
  baseInput: SwapSimulationBaseInput,
  input: SwapStepSimulationInput
): SwapStepSimulationOutput {
  const { whirlpoolData, amountSpecified, swapDirection } = baseInput;

  const { feeRate } = whirlpoolData;

  const feeRatePercentage = PoolUtil.getFeeRate(feeRate);

  const { amountRemaining, liquidity, sqrtPriceX64, tickIndex, tickArraysCrossed } = input;

  const { tickIndex: nextTickIndex, tickArraysCrossed: tickArraysCrossedUpdate } =
    // Return last tick in tick array if max tick arrays crossed
    // Error out of this gets called for another iteration
    getNextInitializedTickIndex(baseInput, tickIndex, tickArraysCrossed);

  const targetSqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(nextTickIndex);

  let fixedDelta = getAmountFixedDelta(
    sqrtPriceX64,
    targetSqrtPriceX64,
    liquidity,
    amountSpecified,
    swapDirection
  );

  let amountCalculated = amountRemaining;
  if (amountSpecified == AmountSpecified.Input) {
    amountCalculated = calculateAmountAfterFees(amountRemaining, feeRatePercentage);
  }

  const nextSqrtPriceX64 = amountCalculated.gte(fixedDelta)
    ? targetSqrtPriceX64 // Fully utilize liquidity till upcoming (next/prev depending on swap type) initialized tick
    : getNextSqrtPrice(sqrtPriceX64, liquidity, amountCalculated, amountSpecified, swapDirection);

  const hasReachedNextTick = nextSqrtPriceX64.eq(targetSqrtPriceX64);

  const unfixedDelta = getAmountUnfixedDelta(
    sqrtPriceX64,
    nextSqrtPriceX64,
    liquidity,
    amountSpecified,
    swapDirection
  );

  if (!hasReachedNextTick) {
    fixedDelta = getAmountFixedDelta(
      sqrtPriceX64,
      nextSqrtPriceX64,
      liquidity,
      amountSpecified,
      swapDirection
    );
  }

  let [inputDelta, outputDelta] = resolveTokenAmounts(fixedDelta, unfixedDelta, amountSpecified);

  // Cap output if output specified
  if (amountSpecified == AmountSpecified.Output && outputDelta.gt(amountRemaining)) {
    outputDelta = amountRemaining;
  }

  if (amountSpecified == AmountSpecified.Input && !hasReachedNextTick) {
    inputDelta = amountRemaining;
  } else {
    inputDelta = inputDelta.add(calculateFeesFromAmount(inputDelta, feeRatePercentage));
  }

  return {
    nextTickIndex,
    nextSqrtPriceX64,
    input: inputDelta,
    output: outputDelta,
    tickArraysCrossed: tickArraysCrossedUpdate,
    hasReachedNextTick,
  };
}

function calculateAmountAfterFees(amount: u64, feeRate: Percentage): BN {
  return amount.mul(feeRate.denominator.sub(feeRate.numerator)).div(feeRate.denominator);
}

function calculateFeesFromAmount(amount: u64, feeRate: Percentage): BN {
  return MathUtil.divRoundUp(
    amount.mul(feeRate.numerator),
    feeRate.denominator.sub(feeRate.numerator)
  );
}

function calculateNewLiquidity(liquidity: BN, nextLiquidityNet: BN, swapDirection: SwapDirection) {
  if (swapDirection == SwapDirection.AtoB) {
    nextLiquidityNet = nextLiquidityNet.neg();
  }

  return liquidity.add(nextLiquidityNet);
}

function resolveTokenAmounts(
  specifiedTokenAmount: BN,
  otherTokenAmount: BN,
  amountSpecified: AmountSpecified
): [BN, BN] {
  if (amountSpecified == AmountSpecified.Input) {
    return [specifiedTokenAmount, otherTokenAmount];
  } else {
    return [otherTokenAmount, specifiedTokenAmount];
  }
}

function fetchTickArray(baseInput: SwapSimulationBaseInput, tickIndex: number) {
  const {
    tickArrays,
    whirlpoolData: { tickSpacing },
  } = baseInput;

  const startTickArray = tickArrays[0];
  invariant(!!startTickArray, `tickArray is null at index 0`);
  const sequenceStartIndex = startTickArray.startTickIndex;
  const expectedArrayIndex = Math.abs(
    Math.floor((tickIndex - sequenceStartIndex) / tickSpacing / TICK_ARRAY_SIZE)
  );

  invariant(
    expectedArrayIndex > 0 || expectedArrayIndex < tickArrays.length,
    `tickIndex ${tickIndex} assumes array-index of ${expectedArrayIndex} and is out of bounds for sequence`
  );

  const tickArray = tickArrays[expectedArrayIndex];
  invariant(!!tickArray, `tickArray is null at array-index ${expectedArrayIndex}`);

  return tickArray;
}

function fetchTick(baseInput: SwapSimulationBaseInput, tickIndex: number) {
  const tickArray = fetchTickArray(baseInput, tickIndex);
  const {
    whirlpoolData: { tickSpacing },
  } = baseInput;
  return TickArrayUtil.getTickFromArray(tickArray, tickIndex, tickSpacing);
}

function getNextInitializedTickIndex(
  baseInput: SwapSimulationBaseInput,
  currentTickIndex: number,
  tickArraysCrossed: number
) {
  const {
    whirlpoolData: { tickSpacing },
    swapDirection,
  } = baseInput;
  let nextInitializedTickIndex: number | undefined = undefined;

  while (nextInitializedTickIndex === undefined) {
    const currentTickArray = fetchTickArray(baseInput, currentTickIndex);

    let temp;
    if (swapDirection == SwapDirection.AtoB) {
      temp = TickUtil.findPreviousInitializedTickIndex(
        currentTickArray,
        currentTickIndex,
        tickSpacing
      );
    } else {
      temp = TickUtil.findNextInitializedTickIndex(currentTickArray, currentTickIndex, tickSpacing);
    }

    if (temp) {
      nextInitializedTickIndex = temp;
    } else if (tickArraysCrossed === MAX_TICK_ARRAY_CROSSINGS) {
      if (swapDirection === SwapDirection.AtoB) {
        nextInitializedTickIndex = currentTickArray.startTickIndex;
      } else {
        nextInitializedTickIndex = currentTickArray.startTickIndex + TICK_ARRAY_SIZE * tickSpacing;
      }
      tickArraysCrossed++;
    } else {
      if (swapDirection === SwapDirection.AtoB) {
        currentTickIndex = currentTickArray.startTickIndex - 1;
      } else {
        currentTickIndex = currentTickArray.startTickIndex + TICK_ARRAY_SIZE * tickSpacing - 1;
      }
      tickArraysCrossed++;
    }
  }

  return {
    tickIndex: nextInitializedTickIndex,
    tickArraysCrossed,
  };
}
