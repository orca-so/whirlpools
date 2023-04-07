import * as assert from "assert";
import { PositionBundleUtil, POSITION_BUNDLE_SIZE } from "../../../../src";
import { buildPositionBundleData } from "../../../utils/testDataTypes";

describe("PositionBundleUtil tests", () => {
  const occupiedEmpty: number[] = [];
  const occupiedPartial: number[] = [0, 1, 5, 49, 128, 193, 255];
  const occupiedFull: number[] = new Array(POSITION_BUNDLE_SIZE).fill(0).map((a, i) => i);

  describe("checkBundleIndexInBounds", () => {
    it("valid bundle indexes", async () => {
      for (let bundleIndex=0; bundleIndex<POSITION_BUNDLE_SIZE; bundleIndex++) {
        assert.ok(PositionBundleUtil.checkBundleIndexInBounds(bundleIndex));
      }
    });

    it("less than zero", async () => {
      assert.ok(!PositionBundleUtil.checkBundleIndexInBounds(-1));
    });

    it("greater than or equal to POSITION_BUNDLE_SIZE", async () => {
      assert.ok(!PositionBundleUtil.checkBundleIndexInBounds(POSITION_BUNDLE_SIZE));
      assert.ok(!PositionBundleUtil.checkBundleIndexInBounds(POSITION_BUNDLE_SIZE+1));
    });
  });

  it("isOccupied / isUnoccupied", async () => {
    const positionBundle = buildPositionBundleData(occupiedPartial);

    for (let bundleIndex=0; bundleIndex<POSITION_BUNDLE_SIZE; bundleIndex++) {
      if (occupiedPartial.includes(bundleIndex)) {
        assert.ok(PositionBundleUtil.isOccupied(positionBundle, bundleIndex));
        assert.ok(!PositionBundleUtil.isUnoccupied(positionBundle, bundleIndex));
      }
      else {
        assert.ok(PositionBundleUtil.isUnoccupied(positionBundle, bundleIndex));
        assert.ok(!PositionBundleUtil.isOccupied(positionBundle, bundleIndex));
      }
    }
  });

  describe("isFull / isEmpty", () => {
    it("empty", async () => {
      const positionBundle = buildPositionBundleData(occupiedEmpty);
      assert.ok(PositionBundleUtil.isEmpty(positionBundle));
      assert.ok(!PositionBundleUtil.isFull(positionBundle));
    });

    it("some bundle indexes are occupied", async () => {
      const positionBundle = buildPositionBundleData(occupiedPartial);
      assert.ok(!PositionBundleUtil.isEmpty(positionBundle));
      assert.ok(!PositionBundleUtil.isFull(positionBundle));
    });

    it("full", async () => {
      const positionBundle = buildPositionBundleData(occupiedFull);
      assert.ok(!PositionBundleUtil.isEmpty(positionBundle));
      assert.ok(PositionBundleUtil.isFull(positionBundle));
    })
  })

  describe("getOccupiedBundleIndexes", () => {
    it("empty", async () => {
      const positionBundle = buildPositionBundleData(occupiedEmpty);
      const result = PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
      assert.equal(result.length, 0);  
    });

    it("some bundle indexes are occupied", async () => {
      const positionBundle = buildPositionBundleData(occupiedPartial);
      const result = PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
      assert.equal(result.length, occupiedPartial.length);
      assert.ok(occupiedPartial.every(index => result.includes(index)));
    });

    it("full", async () => {
      const positionBundle = buildPositionBundleData(occupiedFull);
      const result = PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
      assert.equal(result.length, POSITION_BUNDLE_SIZE);
      assert.ok(occupiedFull.every(index => result.includes(index)));
    })
  });

  describe("getUnoccupiedBundleIndexes", () => {
    it("empty", async () => {
      const positionBundle = buildPositionBundleData(occupiedEmpty);
      const result = PositionBundleUtil.getUnoccupiedBundleIndexes(positionBundle);
      assert.equal(result.length, POSITION_BUNDLE_SIZE);
      assert.ok(occupiedFull.every(index => result.includes(index)));
    });

    it("some bundle indexes are occupied", async () => {
      const positionBundle = buildPositionBundleData(occupiedPartial);
      const result = PositionBundleUtil.getUnoccupiedBundleIndexes(positionBundle);
      assert.equal(result.length, POSITION_BUNDLE_SIZE - occupiedPartial.length);
      assert.ok(occupiedPartial.every(index => !result.includes(index)));
    });

    it("full", async () => {
      const positionBundle = buildPositionBundleData(occupiedFull);
      const result = PositionBundleUtil.getUnoccupiedBundleIndexes(positionBundle);
      assert.equal(result.length, 0);  
    })
  });


  describe("findUnoccupiedBundleIndex", () => {
    it("empty", async () => {
      const positionBundle = buildPositionBundleData(occupiedEmpty);
      const result = PositionBundleUtil.findUnoccupiedBundleIndex(positionBundle);
      assert.equal(result, 0);
    });

    it("some bundle indexes are occupied", async () => {
      const positionBundle = buildPositionBundleData(occupiedPartial);
      const result = PositionBundleUtil.findUnoccupiedBundleIndex(positionBundle);
      assert.equal(result, 2);
    });

    it("full", async () => {
      const positionBundle = buildPositionBundleData(occupiedFull);
      const result = PositionBundleUtil.findUnoccupiedBundleIndex(positionBundle);
      assert.ok(result === null);
    })
  });

  describe("convertBitmapToArray", () => {
    it("empty", async () => {
      const positionBundle = buildPositionBundleData(occupiedEmpty);
      const result = PositionBundleUtil.convertBitmapToArray(positionBundle);
      assert.equal(result.length, POSITION_BUNDLE_SIZE);
      assert.ok(result.every((occupied) => !occupied));
    });

    it("some bundle indexes are occupied", async () => {
      const positionBundle = buildPositionBundleData(occupiedPartial);
      const result = PositionBundleUtil.convertBitmapToArray(positionBundle);
      assert.equal(result.length, POSITION_BUNDLE_SIZE);
      assert.ok(result.every((occupied, i) => occupied === occupiedPartial.includes(i)));
    });

    it("full", async () => {
      const positionBundle = buildPositionBundleData(occupiedFull);
      const result = PositionBundleUtil.convertBitmapToArray(positionBundle);
      assert.equal(result.length, POSITION_BUNDLE_SIZE);
      assert.ok(result.every((occupied) => occupied));
    })
  });
});
