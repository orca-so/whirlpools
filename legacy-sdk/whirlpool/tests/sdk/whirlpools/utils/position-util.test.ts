import * as assert from "assert";
import { PriceMath } from "../../../../src";
import { PositionStatus, PositionUtil } from "../../../../src/utils/position-util";

describe("PositionUtil tests", () => {
  const tickLowerIndex = 64;
  const tickUpperIndex = 128;

  describe("getPositionStatus", () => {
    it("tickCurrentIndex < tickLowerIndex, BelowRange", async () => {
      const tickCurrentIndex = 0;
      const result = PositionUtil.getPositionStatus(tickCurrentIndex, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.BelowRange);
    });

    it("tickCurrentIndex + 1 == tickLowerIndex, BelowRange", async () => {
      const tickCurrentIndex = tickLowerIndex - 1;
      const result = PositionUtil.getPositionStatus(tickCurrentIndex, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.BelowRange);
    });

    it("tickCurrentIndex == tickLowerIndex, InRange", async () => {
      const tickCurrentIndex = tickLowerIndex;
      const result = PositionUtil.getPositionStatus(tickCurrentIndex, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.InRange);
    });

    it("tickCurrentIndex + 1 == tickUpperIndex, InRange", async () => {
      const tickCurrentIndex = tickUpperIndex - 1;
      const result = PositionUtil.getPositionStatus(tickCurrentIndex, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.InRange);
    });

    it("tickCurrentIndex == tickUpperIndex, AboveRange", async () => {
      const tickCurrentIndex = tickUpperIndex;
      const result = PositionUtil.getPositionStatus(tickCurrentIndex, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.AboveRange);
    });

    it("tickCurrentIndex > tickUpperIndex, AboveRange", async () => {
      const tickCurrentIndex = 192;
      const result = PositionUtil.getPositionStatus(tickCurrentIndex, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.AboveRange);
    });

  });

  describe("getStrictPositionStatus", async () => {
    it("sqrtPrice < toSqrtPrice(tickLowerIndex), BelowRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(0);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.BelowRange);
    });

    it("sqrtPrice + 1 == toSqrtPrice(tickLowerIndex), BelowRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex).subn(1);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.BelowRange);
    });

    it("sqrtPrice == toSqrtPrice(tickLowerIndex), BelowRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.BelowRange);
    });

    it("sqrtPrice - 1 == toSqrtPrice(tickLowerIndex), InRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex).addn(1);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.InRange);
    });

    it("sqrtPrice + 1 == toSqrtPrice(tickUpperIndex), InRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex).subn(1);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.InRange);
    });

    it("sqrtPrice == toSqrtPrice(tickUpperIndex), AboveRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.AboveRange);
    });

    it("sqrtPrice - 1 == toSqrtPrice(tickUpperIndex), AboveRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex).addn(1);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.AboveRange);
    });

    it("sqrtPrice > toSqrtPrice(tickUpperIndex), AboveRange", async () => {
      const sqrtPriceX64 = PriceMath.tickIndexToSqrtPriceX64(192);
      const result = PositionUtil.getStrictPositionStatus(sqrtPriceX64, tickLowerIndex, tickUpperIndex);
      assert.equal(result, PositionStatus.AboveRange);
    });

  });
});
