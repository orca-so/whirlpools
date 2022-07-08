import { ZERO, ONE, MathUtil, TWO, U64_MAX } from "@orca-so/common-sdk";
import { BN } from "@project-serum/anchor";
import { MathErrorCode, WhirlpoolsError } from "../../errors/errors";

export class BitMath {
  static mul(n0: BN, n1: BN, limit: number): BN {
    const result = n0.mul(n1);
    if (this.isOverLimit(result, limit)) {
      throw new WhirlpoolsError(
        `Mul result higher than u${limit}`,
        MathErrorCode.MultiplicationOverflow
      );
    }
    return result;
  }

  static mulDiv(n0: BN, n1: BN, d: BN, limit: number): BN {
    return this.mulDivRoundUpIf(n0, n1, d, false, limit);
  }

  static mulDivRoundUp(n0: BN, n1: BN, d: BN, limit: number): BN {
    return this.mulDivRoundUpIf(n0, n1, d, true, limit);
  }

  static mulDivRoundUpIf(n0: BN, n1: BN, d: BN, roundUp: boolean, limit: number): BN {
    if (d.eq(ZERO)) {
      throw new WhirlpoolsError("checkedMulDiv denominator is zero", MathErrorCode.DivideByZero);
    }

    const p = this.mul(n0, n1, limit);
    const n = p.div(d);

    return roundUp && p.mod(d).gt(ZERO) ? n.add(ONE) : n;
  }

  static checked_mul_shift_right(n0: BN, n1: BN, limit: number) {
    return this.checked_mul_shift_right_round_up_if(n0, n1, false, limit);
  }

  static checked_mul_shift_right_round_up_if(n0: BN, n1: BN, roundUp: boolean, limit: number) {
    if (n0.eq(ZERO) || n1.eq(ZERO)) {
      return ZERO;
    }

    const p = this.mul(n0, n1, limit);
    if (this.isOverLimit(p, limit)) {
      throw new WhirlpoolsError(
        `MulDivShiftRight overflowed u${limit}.`,
        MathErrorCode.MultiplicationShiftRightOverflow
      );
    }
    const result = MathUtil.fromX64_BN(p);
    const shouldRound = roundUp && result.and(U64_MAX).gt(ZERO);
    if (shouldRound && result.eq(U64_MAX)) {
      throw new WhirlpoolsError(
        `MulDivShiftRight overflowed u${limit}.`,
        MathErrorCode.MultiplicationOverflow
      );
    }

    return shouldRound ? result.add(ONE) : result;
  }

  static isOverLimit(n0: BN, limit: number) {
    const limitBN = TWO.pow(new BN(limit)).sub(ONE);
    return n0.gt(limitBN);
  }

  static divRoundUp(n: BN, d: BN) {
    return this.divRoundUpIf(n, d, true);
  }

  static divRoundUpIf(n: BN, d: BN, roundUp: boolean) {
    if (d.eq(ZERO)) {
      throw new WhirlpoolsError("divRoundUpIf - divide by zero", MathErrorCode.DivideByZero);
    }

    let q = n.div(d);

    return roundUp && n.mod(d).gt(ZERO) ? q.add(ONE) : q;
  }
}
