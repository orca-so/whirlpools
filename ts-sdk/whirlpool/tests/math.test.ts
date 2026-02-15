import { describe, it } from "vitest";
import assert from "assert";
import { priceToSqrtPrice, sqrtPriceToPrice } from "@orca-so/whirlpools-core";
import { getSqrtPriceSlippageBounds } from "../src/math";

function assertRelativeEq(
  actual: number,
  expected: number,
  maxRelative: number,
  message?: string,
): void {
  const diff = Math.abs(actual - expected);
  const maxAbs = Math.max(Math.abs(actual), Math.abs(expected));
  assert.ok(
    diff / maxAbs <= maxRelative,
    message ??
      `Expected ${actual} ≈ ${expected} within ${maxRelative} relative tolerance (diff=${diff})`,
  );
}

describe("math", () => {
  const price = 1_000_000;
  const sqrtPrice = priceToSqrtPrice(price, 6, 6);

  it.each([0, 1, 10, 50, 100, 200, 500, 1000, 5000])(
    "slippage symmetry (slippageBps=%i)",
    (slippageBps) => {
      assert.strictEqual(sqrtPrice, 18446744073709551616000n);

      const { minSqrtPrice, maxSqrtPrice } = getSqrtPriceSlippageBounds(
        sqrtPrice,
        slippageBps,
      );

      const actualMin = sqrtPriceToPrice(minSqrtPrice, 6, 6);
      const actualMax = sqrtPriceToPrice(maxSqrtPrice, 6, 6);

      const expectedMin = (price * (10_000 - slippageBps)) / 10_000;
      const expectedMax = (price * (10_000 + slippageBps)) / 10_000;

      assertRelativeEq(actualMin, expectedMin, 0.0001);
      assertRelativeEq(actualMax, expectedMax, 0.0001);
    },
  );
});
