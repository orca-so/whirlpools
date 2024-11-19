import BN from "bn.js";
import Decimal from "decimal.js";

/**
 * @category Math
 */
export const ZERO = new BN(0);

/**
 * @category Math
 */
export const ONE = new BN(1);

/**
 * @category Math
 */
export const TWO = new BN(2);

/**
 * @category Math
 */
export const U128 = TWO.pow(new BN(128));

/**
 * @category Math
 */
export const U64_MAX = TWO.pow(new BN(64)).sub(ONE);

/**
 * @category Math
 */
export class MathUtil {
  public static toX64_BN(num: BN): BN {
    return num.mul(new BN(2).pow(new BN(64)));
  }

  public static toX64_Decimal(num: Decimal): Decimal {
    return num.mul(Decimal.pow(2, 64));
  }

  public static toX64(num: Decimal): BN {
    return new BN(num.mul(Decimal.pow(2, 64)).floor().toFixed());
  }

  public static fromX64(num: BN): Decimal {
    return new Decimal(num.toString()).mul(Decimal.pow(2, -64));
  }

  public static fromX64_Decimal(num: Decimal): Decimal {
    return num.mul(Decimal.pow(2, -64));
  }

  public static fromX64_BN(num: BN): BN {
    return num.div(new BN(2).pow(new BN(64)));
  }

  public static shiftRightRoundUp(n: BN): BN {
    let result = n.shrn(64);

    if (n.mod(U64_MAX).gt(ZERO)) {
      result = result.add(ONE);
    }

    return result;
  }

  public static divRoundUp(n0: BN, n1: BN): BN {
    const hasRemainder = !n0.mod(n1).eq(ZERO);
    if (hasRemainder) {
      return n0.div(n1).add(new BN(1));
    } else {
      return n0.div(n1);
    }
  }

  public static subUnderflowU128(n0: BN, n1: BN): BN {
    return n0.add(U128).sub(n1).mod(U128);
  }
}
