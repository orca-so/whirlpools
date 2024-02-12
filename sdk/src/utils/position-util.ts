import { BN } from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import {
  getLowerSqrtPriceFromTokenA,
  getLowerSqrtPriceFromTokenB,
  getUpperSqrtPriceFromTokenA,
  getUpperSqrtPriceFromTokenB,
} from "./swap-utils";
import { PriceMath } from "./public";

export enum SwapDirection {
  AtoB = "Swap A to B",
  BtoA = "Swap B to A",
}

export enum AmountSpecified {
  Input = "Specified input amount",
  Output = "Specified output amount",
}

export enum PositionStatus {
  BelowRange,
  InRange,
  AboveRange,
}

export class PositionUtil {
  private constructor() {}

  /**
   * Returns the position status of a given tickCurrentIndex in relation to the tickLowerIndex and tickUpperIndex.
   * If the tickCurrentIndex is below the range, it returns PositionStatus.BelowRange.
   * If the tickCurrentIndex is above the range, it returns PositionStatus.AboveRange.
   * If the tickCurrentIndex is equal to the lower, PositionStatus.InRange is returned.
   * On the other hand, if the tickCurrentIndex is equal to the upper, PositionStatus.AboveRange is returned.
   * The relation "PriceMath.tickIndexToSqrtPriceX64(tickCurrentIndex) <= pool's sqrtPrice" is the reason.
   * 
   * @param tickCurrentIndex - Whirlpool's current tick index.
   * @param tickLowerIndex - The tick specifying the lower end of the position range.
   * @param tickUpperIndex - The tick specifying the upper end of the position range.
   * @returns Position status in the form of PositionStatus enum.
   */
  public static getPositionStatus(
    tickCurrentIndex: number,
    tickLowerIndex: number,
    tickUpperIndex: number
  ): PositionStatus {
    if (tickCurrentIndex < tickLowerIndex) {
      return PositionStatus.BelowRange;
    } else if (tickCurrentIndex < tickUpperIndex) {
      return PositionStatus.InRange;
    } else {
      return PositionStatus.AboveRange;
    }
  }

  /**
   * Returns the position status of a given sqrtPriceX64 in relation to the tickLowerIndex and tickUpperIndex.
   * If the sqrtPriceX64 is below the range, it returns PositionStatus.BelowRange.
   * If the sqrtPriceX64 is above the range, it returns PositionStatus.AboveRange.
   * If the sqrtPriceX64 is equal to the lower or upper, PositionStatus.BelowRange or PositionStatus.AboveRange is returned respectively.
   * 
   * @param sqrtPriceX64 - X64 representation of the square root of the price.
   * @param tickLowerIndex - The tick specifying the lower end of the position range.
   * @param tickUpperIndex - The tick specifying the upper end of the position range.
   * @returns Position status in the form of PositionStatus enum.
   */
  public static getStrictPositionStatus(
    sqrtPriceX64: BN,
    tickLowerIndex: number,
    tickUpperIndex: number
  ): PositionStatus {
    const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
    const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);
  
    if (sqrtPriceX64.lte(sqrtPriceLowerX64)) {
      return PositionStatus.BelowRange;
    } else if (sqrtPriceX64.gte(sqrtPriceUpperX64)) {
      return PositionStatus.AboveRange;
    } else {
      return PositionStatus.InRange;
    }
  }
}

export function adjustForSlippage(
  n: BN,
  { numerator, denominator }: Percentage,
  adjustUp: boolean
): BN {
  if (adjustUp) {
    return n.mul(denominator.add(numerator)).div(denominator);
  } else {
    return n.mul(denominator).div(denominator.add(numerator));
  }
}

export function adjustAmountForSlippage(
  amountIn: BN,
  amountOut: BN,
  { numerator, denominator }: Percentage,
  amountSpecified: AmountSpecified
): BN {
  if (amountSpecified === AmountSpecified.Input) {
    return amountOut.mul(denominator).div(denominator.add(numerator));
  } else {
    return amountIn.mul(denominator.add(numerator)).div(denominator);
  }
}

export function getLiquidityFromTokenA(
  amount: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  roundUp: boolean
) {
  const result = amount
    .mul(sqrtPriceLowerX64)
    .mul(sqrtPriceUpperX64)
    .div(sqrtPriceUpperX64.sub(sqrtPriceLowerX64));
  if (roundUp) {
    return MathUtil.shiftRightRoundUp(result);
  } else {
    return result.shrn(64);
  }
}

export function getLiquidityFromTokenB(
  amount: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  roundUp: boolean
) {
  const numerator = amount.shln(64);
  const denominator = sqrtPriceUpperX64.sub(sqrtPriceLowerX64);
  if (roundUp) {
    return MathUtil.divRoundUp(numerator, denominator);
  } else {
    return numerator.div(denominator);
  }
}

export function getAmountFixedDelta(
  currentSqrtPriceX64: BN,
  targetSqrtPriceX64: BN,
  liquidity: BN,
  amountSpecified: AmountSpecified,
  swapDirection: SwapDirection
) {
  if ((amountSpecified == AmountSpecified.Input) == (swapDirection == SwapDirection.AtoB)) {
    return getTokenAFromLiquidity(
      liquidity,
      currentSqrtPriceX64,
      targetSqrtPriceX64,
      amountSpecified == AmountSpecified.Input
    );
  } else {
    return getTokenBFromLiquidity(
      liquidity,
      currentSqrtPriceX64,
      targetSqrtPriceX64,
      amountSpecified == AmountSpecified.Input
    );
  }
}

export function getAmountUnfixedDelta(
  currentSqrtPriceX64: BN,
  targetSqrtPriceX64: BN,
  liquidity: BN,
  amountSpecified: AmountSpecified,
  swapDirection: SwapDirection
) {
  if ((amountSpecified == AmountSpecified.Input) == (swapDirection == SwapDirection.AtoB)) {
    return getTokenBFromLiquidity(
      liquidity,
      currentSqrtPriceX64,
      targetSqrtPriceX64,
      amountSpecified == AmountSpecified.Output
    );
  } else {
    return getTokenAFromLiquidity(
      liquidity,
      currentSqrtPriceX64,
      targetSqrtPriceX64,
      amountSpecified == AmountSpecified.Output
    );
  }
}

export function getNextSqrtPrice(
  sqrtPriceX64: BN,
  liquidity: BN,
  amount: BN,
  amountSpecified: AmountSpecified,
  swapDirection: SwapDirection
) {
  if (amountSpecified === AmountSpecified.Input && swapDirection === SwapDirection.AtoB) {
    return getLowerSqrtPriceFromTokenA(amount, liquidity, sqrtPriceX64);
  } else if (amountSpecified === AmountSpecified.Output && swapDirection === SwapDirection.BtoA) {
    return getUpperSqrtPriceFromTokenA(amount, liquidity, sqrtPriceX64);
  } else if (amountSpecified === AmountSpecified.Input && swapDirection === SwapDirection.BtoA) {
    return getUpperSqrtPriceFromTokenB(amount, liquidity, sqrtPriceX64);
  } else {
    return getLowerSqrtPriceFromTokenB(amount, liquidity, sqrtPriceX64);
  }
}

export function getTokenAFromLiquidity(
  liquidity: BN,
  sqrtPrice0X64: BN,
  sqrtPrice1X64: BN,
  roundUp: boolean
) {
  const [sqrtPriceLowerX64, sqrtPriceUpperX64] = orderSqrtPrice(sqrtPrice0X64, sqrtPrice1X64);

  const numerator = liquidity.mul(sqrtPriceUpperX64.sub(sqrtPriceLowerX64)).shln(64);
  const denominator = sqrtPriceUpperX64.mul(sqrtPriceLowerX64);
  if (roundUp) {
    return MathUtil.divRoundUp(numerator, denominator);
  } else {
    return numerator.div(denominator);
  }
}

export function getTokenBFromLiquidity(
  liquidity: BN,
  sqrtPrice0X64: BN,
  sqrtPrice1X64: BN,
  roundUp: boolean
) {
  const [sqrtPriceLowerX64, sqrtPriceUpperX64] = orderSqrtPrice(sqrtPrice0X64, sqrtPrice1X64);

  const result = liquidity.mul(sqrtPriceUpperX64.sub(sqrtPriceLowerX64));
  if (roundUp) {
    return MathUtil.shiftRightRoundUp(result);
  } else {
    return result.shrn(64);
  }
}

/** Private */

function orderSqrtPrice(sqrtPrice0X64: BN, sqrtPrice1X64: BN): [BN, BN] {
  if (sqrtPrice0X64.lt(sqrtPrice1X64)) {
    return [sqrtPrice0X64, sqrtPrice1X64];
  } else {
    return [sqrtPrice1X64, sqrtPrice0X64];
  }
}
