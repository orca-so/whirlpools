import BN from "bn.js";
import Decimal from "decimal.js";

/**
 * @category Math
 */
export class Percentage {
  readonly numerator: BN;
  readonly denominator: BN;

  constructor(numerator: BN, denominator: BN) {
    this.numerator = numerator;
    this.denominator = denominator;
  }

  public static fromDecimal(number: Decimal): Percentage {
    return Percentage.fromFraction(number.mul(100000).toNumber(), 10000000);
  }

  public static fromFraction(
    numerator: BN | number,
    denominator: BN | number,
  ): Percentage {
    const num =
      typeof numerator === "number" ? new BN(numerator.toString()) : numerator;
    const denom =
      typeof denominator === "number"
        ? new BN(denominator.toString())
        : denominator;
    return new Percentage(num, denom);
  }

  public toString = (): string => {
    return `${this.numerator.toString()}/${this.denominator.toString()}`;
  };

  public toDecimal() {
    if (this.denominator.eq(new BN(0))) {
      return new Decimal(0);
    }
    return new Decimal(this.numerator.toString()).div(
      new Decimal(this.denominator.toString()),
    );
  }

  public add(p2: Percentage): Percentage {
    const denomGcd = this.denominator.gcd(p2.denominator);
    const denomLcm = this.denominator.div(denomGcd).mul(p2.denominator);

    const p1DenomAdjustment = denomLcm.div(this.denominator);
    const p2DenomAdjustment = denomLcm.div(p2.denominator);

    const p1NumeratorAdjusted = this.numerator.mul(p1DenomAdjustment);
    const p2NumeratorAdjusted = p2.numerator.mul(p2DenomAdjustment);

    const newNumerator = p1NumeratorAdjusted.add(p2NumeratorAdjusted);

    return new Percentage(
      new BN(newNumerator.toString()),
      new BN(denomLcm.toString()),
    );
  }
}
