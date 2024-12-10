import BN from "bn.js";
import Decimal from "decimal.js";

export class DecimalUtil {
  public static adjustDecimals(input: Decimal, shift = 0): Decimal {
    return input.div(Decimal.pow(10, shift));
  }

  public static fromBN(input: BN, shift = 0): Decimal {
    return new Decimal(input.toString()).div(new Decimal(10).pow(shift));
  }

  public static fromNumber(input: number, shift = 0): Decimal {
    return new Decimal(input).div(new Decimal(10).pow(shift));
  }

  public static toBN(input: Decimal, shift = 0): BN {
    if (input.isNeg()) {
      throw new Error(
        "Negative decimal value ${input} cannot be converted to BN.",
      );
    }

    const shiftedValue = input.mul(new Decimal(10).pow(shift));
    const zeroDecimalValue = shiftedValue.trunc();
    return new BN(zeroDecimalValue.toString());
  }
}
