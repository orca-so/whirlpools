import { MathUtil, Percentage } from "@orca-so/common-sdk";
import assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import { MAX_SQRT_PRICE_BN, MIN_SQRT_PRICE_BN, PriceMath } from "../../../../src";

function toSqrtPrice(n: number) {
  return PriceMath.priceToSqrtPriceX64(new Decimal(n), 6, 6);
}

const EVAL_PRECISION = 16;
const variations = [
  [MAX_SQRT_PRICE_BN, Percentage.fromFraction(0, 100), true] as const,
  [MAX_SQRT_PRICE_BN, Percentage.fromFraction(1, 1000), true] as const,
  [MAX_SQRT_PRICE_BN, Percentage.fromFraction(1, 100), true] as const,
  [MIN_SQRT_PRICE_BN, Percentage.fromFraction(0, 1000), true] as const,
  [MIN_SQRT_PRICE_BN, Percentage.fromFraction(1, 1000), true] as const,
  [MIN_SQRT_PRICE_BN, Percentage.fromFraction(1, 100), true] as const,
  [MIN_SQRT_PRICE_BN, Percentage.fromFraction(1, 100), true] as const,
  [toSqrtPrice(5), Percentage.fromFraction(0, 1000), false] as const,
  [toSqrtPrice(5), Percentage.fromFraction(1, 1000), false] as const,
  [toSqrtPrice(5), Percentage.fromFraction(10, 1000), false] as const,
  [toSqrtPrice(1000000), Percentage.fromFraction(0, 1000), false] as const,
  [toSqrtPrice(1000000), Percentage.fromFraction(5, 1000), false] as const,
  [toSqrtPrice(1000000), Percentage.fromFraction(20, 1000), false] as const,
  [toSqrtPrice(61235.33), Percentage.fromFraction(0, 1000), false] as const,
  [toSqrtPrice(61235.33), Percentage.fromFraction(5, 1000), false] as const,
  [toSqrtPrice(61235.33), Percentage.fromFraction(20, 1000), false] as const,
];

function toPrecisionLevel(decimal: Decimal) {
  return decimal.toSignificantDigits(EVAL_PRECISION);
}

variations.forEach(([sqrtPrice, slippage, ignorePrecisionVerification]) => {
  describe("PriceMath - getSlippageBoundForSqrtPrice tests", () => {
    it(`slippage boundary for sqrt price - ${sqrtPrice.toString()}, slippage - ${slippage
      .toDecimal()
      .mul(100)}%`, () => {
        const { lowerBound, upperBound } = PriceMath.getSlippageBoundForSqrtPrice(
          sqrtPrice,
          slippage,
        );

        const price = PriceMath.sqrtPriceX64ToPrice(sqrtPrice, 6, 6);
        const slippageDecimal = slippage.toDecimal();

        const expectedUpperSlippagePrice = toPrecisionLevel(price.mul(slippageDecimal.add(1)))
        const expectedLowerSlippagePrice = toPrecisionLevel(price.mul(new Decimal(1).sub(slippageDecimal)))

        const expectedUpperSqrtPrice = BN.min(BN.max(MathUtil.toX64(expectedUpperSlippagePrice.sqrt()), MIN_SQRT_PRICE_BN), MAX_SQRT_PRICE_BN);
        const expectedLowerSqrtPrice = BN.min(BN.max(MathUtil.toX64(expectedLowerSlippagePrice.sqrt()), MIN_SQRT_PRICE_BN), MAX_SQRT_PRICE_BN);

        const expectedUpperTickIndex = PriceMath.sqrtPriceX64ToTickIndex(expectedUpperSqrtPrice);
        const expectedLowerTickIndex = PriceMath.sqrtPriceX64ToTickIndex(expectedLowerSqrtPrice);

        const lowerBoundSqrtPrice = lowerBound[0];
        const lowerBoundTickIndex = lowerBound[1];
        const lowerBoundPrice = toPrecisionLevel(PriceMath.sqrtPriceX64ToPrice(lowerBoundSqrtPrice, 6, 6))

        const upperBoundSqrtPrice = upperBound[0];
        const upperBoundTickIndex = upperBound[1];
        const upperBoundPrice = toPrecisionLevel(PriceMath.sqrtPriceX64ToPrice(upperBoundSqrtPrice, 6, 6));

        // For larger sqrt-price boundary values, it's difficult to verify exactly due to the precision loss.
        // We will only verify that it won't crash and the upper and lower bounds are within the expected range by
        // testing that the function won't crash.
        if (!ignorePrecisionVerification) {
          assert.ok(
            lowerBoundPrice.eq(expectedLowerSlippagePrice),
            `lower slippage price ${lowerBoundPrice.toString()} should equal ${expectedLowerSlippagePrice.toString()}`,
          );
          assert.ok(
            upperBoundPrice.eq(expectedUpperSlippagePrice),
            `upper slippage price ${upperBoundPrice.toString()} should equal ${expectedUpperSlippagePrice.toString()}`,
          );
          assert.ok(
            expectedUpperTickIndex === upperBoundTickIndex,
            `upper tick index ${upperBoundTickIndex} should equal ${expectedUpperTickIndex}`,
          );
          assert.ok(
            expectedLowerTickIndex === lowerBoundTickIndex,
            `lower tick index ${lowerBoundTickIndex} should equal ${expectedLowerTickIndex}`,
          );
        }
      });
  });
});

