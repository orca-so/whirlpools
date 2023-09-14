import * as assert from "assert";
import { TickUtil, MIN_TICK_INDEX, MAX_TICK_INDEX } from "../../../../src";

describe("TickUtil tests", () => {
  describe("getFullRangeTickIndex", () => {
    function checkGetFullRangeTickIndex(tickSpacing: number, minMaxAbs: number) {
      const [min, max] = TickUtil.getFullRangeTickIndex(tickSpacing);
      assert.equal(min, -minMaxAbs);
      assert.equal(max, +minMaxAbs);
      assert.ok(-minMaxAbs - tickSpacing < MIN_TICK_INDEX);
      assert.ok(+minMaxAbs + tickSpacing > MAX_TICK_INDEX);
    }

    it("tickSpacing = 1", async () => {
      const [min, max] = TickUtil.getFullRangeTickIndex(1);
      assert.equal(min, MIN_TICK_INDEX);
      assert.equal(max, MAX_TICK_INDEX);
    });

    it("tickSpacing = 8", async () => {
      checkGetFullRangeTickIndex(8, 443632);
    });

    it("tickSpacing = 64", async () => {
      checkGetFullRangeTickIndex(64, 443584);
    });

    it("tickSpacing = 128", async () => {
      checkGetFullRangeTickIndex(128, 443520);
    });
  });

  describe("isFullRange", () => {
    function checkIsFullRange(tickSpacing: number) {
      const [min, max] = TickUtil.getFullRangeTickIndex(tickSpacing);

      assert.ok(TickUtil.isFullRange(tickSpacing, min, max));

      for (let minShift = -1; minShift <= 1; minShift++) {
        for (let maxShift = -1; maxShift <= 1; maxShift++) {
          const isFullRange = minShift === 0 && maxShift === 0;

          assert.equal(
            TickUtil.isFullRange(
              tickSpacing,
              min + minShift * tickSpacing,
              max + maxShift * tickSpacing
            ),
            isFullRange
          );
        }
      }
    }

    it("tickSpacing = [1, 2, 4, 8, ...., 128, 256]", async () => {
      for (let tickSpacing = 1; tickSpacing <= 256; tickSpacing *= 2) {
        checkIsFullRange(tickSpacing);
      }
    });
  });
});
