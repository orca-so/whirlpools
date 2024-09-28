import type { Percentage } from "@orca-so/common-sdk";
import { MathUtil, ONE, U64_MAX, ZERO } from "@orca-so/common-sdk";
import BN from "bn.js";
import {
  MathErrorCode,
  TokenErrorCode,
  WhirlpoolsError,
} from "../../errors/errors";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "../../types/public";
import { BitMath } from "./bit-math";
import invariant from "tiny-invariant";

type AmountDeltaU64Valid = {
  type: "Valid";
  value: BN;
};
type AmountDeltaU64ExceedsMax = {
  type: "ExceedsMax";
  error: Error;
};

export class AmountDeltaU64 {
  constructor(private inner: AmountDeltaU64Valid | AmountDeltaU64ExceedsMax) {}

  public static fromValid(value: BN): AmountDeltaU64 {
    return new AmountDeltaU64({
      type: "Valid",
      value,
    });
  }

  public static fromExceedsMax(error: Error): AmountDeltaU64 {
    return new AmountDeltaU64({
      type: "ExceedsMax",
      error,
    });
  }

  public lte(other: BN): boolean {
    if (this.inner.type === "ExceedsMax") {
      return false;
    }
    return this.inner.value.lte(other);
  }

  public exceedsMax(): boolean {
    return this.inner.type === "ExceedsMax";
  }

  public value(): BN {
    invariant(this.inner.type === "Valid", "Expected valid AmountDeltaU64");
    return this.inner.value;
  }

  public unwrap(): BN {
    if (this.inner.type === "Valid") {
      return this.inner.value;
    } else {
      throw this.inner.error;
    }
  }
}

export function getAmountDeltaA(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  roundUp: boolean,
): BN {
  return tryGetAmountDeltaA(
    currSqrtPrice,
    targetSqrtPrice,
    currLiquidity,
    roundUp,
  ).unwrap();
}

export function tryGetAmountDeltaA(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  roundUp: boolean,
): AmountDeltaU64 {
  let [sqrtPriceLower, sqrtPriceUpper] = toIncreasingPriceOrder(
    currSqrtPrice,
    targetSqrtPrice,
  );
  let sqrtPriceDiff = sqrtPriceUpper.sub(sqrtPriceLower);

  let numerator = currLiquidity.mul(sqrtPriceDiff).shln(64);
  let denominator = sqrtPriceLower.mul(sqrtPriceUpper);

  let quotient = numerator.div(denominator);
  let remainder = numerator.mod(denominator);

  let result =
    roundUp && !remainder.eq(ZERO) ? quotient.add(new BN(1)) : quotient;

  if (result.gt(U64_MAX)) {
    return AmountDeltaU64.fromExceedsMax(new WhirlpoolsError(
      "Results larger than U64",
      TokenErrorCode.TokenMaxExceeded,
    ));
  }

  return AmountDeltaU64.fromValid(result);
}

export function getAmountDeltaB(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  roundUp: boolean,
): BN {
  return tryGetAmountDeltaB(
    currSqrtPrice,
    targetSqrtPrice,
    currLiquidity,
    roundUp,
  ).unwrap();
}

export function tryGetAmountDeltaB(
  currSqrtPrice: BN,
  targetSqrtPrice: BN,
  currLiquidity: BN,
  roundUp: boolean,
): AmountDeltaU64 {
  let [sqrtPriceLower, sqrtPriceUpper] = toIncreasingPriceOrder(
    currSqrtPrice,
    targetSqrtPrice,
  );

  // customized BitMath.checked_mul_shift_right_round_up_if

  const n0 = currLiquidity;
  const n1 = sqrtPriceUpper.sub(sqrtPriceLower);
  const limit = 128;

  if (n0.eq(ZERO) || n1.eq(ZERO)) {
    return AmountDeltaU64.fromValid(ZERO);
  }

  // we need to use limit * 2 (u256) here to prevent overflow error IN BitMath.mul.
  // we check the overflow in the next step and return wrapped error if it happens.
  const p = BitMath.mul(n0, n1, limit * 2);
  if (BitMath.isOverLimit(p, limit)) {
    return AmountDeltaU64.fromExceedsMax(new WhirlpoolsError(
      `MulShiftRight overflowed u${limit}.`,
      MathErrorCode.MultiplicationShiftRightOverflow,
    ));
  }
  const result = MathUtil.fromX64_BN(p);
  const shouldRound = roundUp && p.and(U64_MAX).gt(ZERO);
  if (shouldRound && result.eq(U64_MAX)) {
    return AmountDeltaU64.fromExceedsMax(new WhirlpoolsError(
      `MulShiftRight overflowed u${limit}.`,
      MathErrorCode.MultiplicationOverflow,
    ));
  }

  return AmountDeltaU64.fromValid(shouldRound ? result.add(ONE) : result);
}

export function getNextSqrtPrice(
  sqrtPrice: BN,
  currLiquidity: BN,
  amount: BN,
  amountSpecifiedIsInput: boolean,
  aToB: boolean,
) {
  if (amountSpecifiedIsInput === aToB) {
    return getNextSqrtPriceFromARoundUp(
      sqrtPrice,
      currLiquidity,
      amount,
      amountSpecifiedIsInput,
    );
  } else {
    return getNextSqrtPriceFromBRoundDown(
      sqrtPrice,
      currLiquidity,
      amount,
      amountSpecifiedIsInput,
    );
  }
}

export function adjustForSlippage(
  n: BN,
  { numerator, denominator }: Percentage,
  adjustUp: boolean,
): BN {
  if (adjustUp) {
    return n.mul(denominator.add(numerator)).div(denominator);
  } else {
    return n.mul(denominator).div(denominator.add(numerator));
  }
}

function toIncreasingPriceOrder(sqrtPrice0: BN, sqrtPrice1: BN) {
  if (sqrtPrice0.gt(sqrtPrice1)) {
    return [sqrtPrice1, sqrtPrice0];
  } else {
    return [sqrtPrice0, sqrtPrice1];
  }
}

function getNextSqrtPriceFromARoundUp(
  sqrtPrice: BN,
  currLiquidity: BN,
  amount: BN,
  amountSpecifiedIsInput: boolean,
) {
  if (amount.eq(ZERO)) {
    return sqrtPrice;
  }

  let p = BitMath.mul(sqrtPrice, amount, 256);
  let numerator = BitMath.mul(currLiquidity, sqrtPrice, 256).shln(64);
  if (BitMath.isOverLimit(numerator, 256)) {
    throw new WhirlpoolsError(
      "getNextSqrtPriceFromARoundUp - numerator overflow u256",
      MathErrorCode.MultiplicationOverflow,
    );
  }

  let currLiquidityShiftLeft = currLiquidity.shln(64);
  if (!amountSpecifiedIsInput && currLiquidityShiftLeft.lte(p)) {
    throw new WhirlpoolsError(
      "getNextSqrtPriceFromARoundUp - Unable to divide currLiquidityX64 by product",
      MathErrorCode.DivideByZero,
    );
  }

  let denominator = amountSpecifiedIsInput
    ? currLiquidityShiftLeft.add(p)
    : currLiquidityShiftLeft.sub(p);

  let price = BitMath.divRoundUp(numerator, denominator);

  if (price.lt(new BN(MIN_SQRT_PRICE))) {
    throw new WhirlpoolsError(
      "getNextSqrtPriceFromARoundUp - price less than min sqrt price",
      TokenErrorCode.TokenMinSubceeded,
    );
  } else if (price.gt(new BN(MAX_SQRT_PRICE))) {
    throw new WhirlpoolsError(
      "getNextSqrtPriceFromARoundUp - price less than max sqrt price",
      TokenErrorCode.TokenMaxExceeded,
    );
  }

  return price;
}

function getNextSqrtPriceFromBRoundDown(
  sqrtPrice: BN,
  currLiquidity: BN,
  amount: BN,
  amountSpecifiedIsInput: boolean,
) {
  let amountX64 = amount.shln(64);

  let delta = BitMath.divRoundUpIf(
    amountX64,
    currLiquidity,
    !amountSpecifiedIsInput,
  );

  if (amountSpecifiedIsInput) {
    sqrtPrice = sqrtPrice.add(delta);
  } else {
    sqrtPrice = sqrtPrice.sub(delta);
  }

  return sqrtPrice;
}
