import { TICK_ARRAY_SIZE } from "../../../../src";
import * as assert from "assert";
import { TickArraySequence } from "../../../../src/quotes/swap/tick-array-sequence";
import { buildTickArrayData, testEmptyTickArrray } from "../../../utils/testDataTypes";
import { TickArrayIndex } from "../../../../src/quotes/swap/tick-array-index";
import { Whirlpool } from "../../../../src/artifacts/whirlpool";
import { SwapErrorCode, WhirlpoolsError } from "../../../../src/errors/errors";

describe("TickArray Sequence tests", () => {
  const ts64 = 64;
  const ts128 = 128;

  describe("isValidTickArray0 tests", () => {
    const ta0 = buildTickArrayData(0, [0, 32, 63]);
    const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -1, [0, 50]);
    const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -2, [25, 50]);

    it("a->b, |--------ta2--------|--------ta1------i-|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(!seq.isValidTickArray0(-1 * ts64));
    });

    it("a->b, |--------ta2--------|--------ta1-------i|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(!seq.isValidTickArray0(-1));
    });

    it("a->b, |--------ta2--------|--------ta1--------|i-------ta0--------|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(seq.isValidTickArray0(0));
    });

    it("a->b, |--------ta2--------|--------ta1--------|-i------ta0--------|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(seq.isValidTickArray0(ts64));
    });

    it("a->b, |--------ta2--------|--------ta1--------|--------ta0-----i--|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(seq.isValidTickArray0(ts64 * TICK_ARRAY_SIZE - ts64 - 1));
    });

    it("a->b, |--------ta2--------|--------ta1--------|--------ta0------i-|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(seq.isValidTickArray0(ts64 * TICK_ARRAY_SIZE - ts64));
    });

    it("a->b, |--------ta2--------|--------ta1--------|--------ta0-------i|", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(seq.isValidTickArray0(ts64 * TICK_ARRAY_SIZE - 1));
    });

    it("a->b, |--------ta2--------|--------ta1--------|--------ta0--------|i", () => {
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      assert.ok(!seq.isValidTickArray0(ts64 * TICK_ARRAY_SIZE));
    });

    it("b->a, i--|--------ta2--------|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta2StartTickIndex = ts64 * TICK_ARRAY_SIZE * -2;
      assert.ok(!seq.isValidTickArray0(ta2StartTickIndex - ts64 - 1));
    });

    it("b->a, -i-|--------ta2--------|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta2StartTickIndex = ts64 * TICK_ARRAY_SIZE * -2;
      assert.ok(seq.isValidTickArray0(ta2StartTickIndex - ts64));
    });

    it("b->a, --i|--------ta2--------|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta2StartTickIndex = ts64 * TICK_ARRAY_SIZE * -2;
      assert.ok(seq.isValidTickArray0(ta2StartTickIndex - 1));
    });

    it("b->a, ---|i-------ta2--------|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta2StartTickIndex = ts64 * TICK_ARRAY_SIZE * -2;
      assert.ok(seq.isValidTickArray0(ta2StartTickIndex));
    });

    it("b->a, ---|-i------ta2--------|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta2StartTickIndex = ts64 * TICK_ARRAY_SIZE * -2;
      assert.ok(seq.isValidTickArray0(ta2StartTickIndex + ts64));
    });

    it("b->a, ---|--------ta2-----i--|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta1StartTickIndex = ts64 * TICK_ARRAY_SIZE * -1;
      assert.ok(seq.isValidTickArray0(ta1StartTickIndex - ts64 - 1));
    });

    it("b->a, ---|--------ta2------i-|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta1StartTickIndex = ts64 * TICK_ARRAY_SIZE * -1;
      assert.ok(!seq.isValidTickArray0(ta1StartTickIndex - ts64));
    });

    it("b->a, ---|--------ta2-------i|--------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta1StartTickIndex = ts64 * TICK_ARRAY_SIZE * -1;
      assert.ok(!seq.isValidTickArray0(ta1StartTickIndex - 1));
    });

    it("b->a, ---|--------ta2--------|i-------ta1--------|--------ta0--------|", () => {
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      const ta1StartTickIndex = ts64 * TICK_ARRAY_SIZE * -1;
      assert.ok(!seq.isValidTickArray0(ta1StartTickIndex));
    });
  });

  describe("findNextInitializedTickIndex tests", () => {
    it("a->b, search reaches left bounds", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -1, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      let i = 0;
      let searchIndex = new TickArrayIndex(-2, 12, ts64).toTickIndex();

      // First traversal brings swap to the left most edge
      const { nextIndex } = seq.findNextInitializedTickIndex(searchIndex);
      assert.equal(nextIndex, ta2.data!.startTickIndex);

      // The next one will throw an error
      assert.throws(
        () => seq.findNextInitializedTickIndex(nextIndex - 1),
        (err) => {
          const whirlErr = err as WhirlpoolsError;
          return whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
        }
      );
    });

    it("b->a, search reaches right bounds", async () => {
      const ta0 = buildTickArrayData(0, [0, 32]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -1, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -2, [25, 50]);
      const seq = new TickArraySequence([ta2, ta1, ta0], ts64, false);
      let i = 0;
      let searchIndex = new TickArrayIndex(0, 33, ts64).toTickIndex();

      // First traversal brings swap to the right most edge
      const { nextIndex } = seq.findNextInitializedTickIndex(searchIndex);
      assert.equal(nextIndex, ta0.data!.startTickIndex + TICK_ARRAY_SIZE * ts64 - 1);

      // The next one will throw an error
      assert.throws(
        () => seq.findNextInitializedTickIndex(nextIndex),
        (err) => {
          const whirlErr = err as WhirlpoolsError;
          return whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
        }
      );
    });

    it("a->b, on initializable index, ts = 64", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -1, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      let i = 0;
      let searchIndex = new TickArrayIndex(0, 32, ts64).toTickIndex();
      const expectedIndicies = [
        new TickArrayIndex(0, 32, ts64).toTickIndex(),
        new TickArrayIndex(0, 0, ts64).toTickIndex(),
        new TickArrayIndex(-1, 50, ts64).toTickIndex(),
        new TickArrayIndex(-1, 0, ts64).toTickIndex(),
        new TickArrayIndex(-2, 50, ts64).toTickIndex(),
        new TickArrayIndex(-2, 25, ts64).toTickIndex(),
        ta2.data!.startTickIndex, // Last index in array 3
      ];

      expectedIndicies.forEach((expectedIndex, expectedResultIndex) => {
        const { nextIndex, nextTickData } = seq.findNextInitializedTickIndex(searchIndex)!;
        if (expectedResultIndex === expectedIndicies.length - 1) {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData === null);
        } else {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData!.initialized);
        }
        searchIndex = nextIndex - 1;
      });
    });

    it("a->b, on initializable index, ts = 64", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -1, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * -2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, true);
      let i = 0;
      let searchIndex = new TickArrayIndex(0, 32, ts64).toTickIndex();
      const expectedIndicies = [
        new TickArrayIndex(0, 32, ts64).toTickIndex(),
        new TickArrayIndex(0, 0, ts64).toTickIndex(),
        new TickArrayIndex(-1, 50, ts64).toTickIndex(),
        new TickArrayIndex(-1, 0, ts64).toTickIndex(),
        new TickArrayIndex(-2, 50, ts64).toTickIndex(),
        new TickArrayIndex(-2, 25, ts64).toTickIndex(),
        ta2.data!.startTickIndex, // Last index in array 3
      ];

      expectedIndicies.forEach((expectedIndex, expectedResultIndex) => {
        const { nextIndex, nextTickData } = seq.findNextInitializedTickIndex(searchIndex)!;
        if (expectedResultIndex === expectedIndicies.length - 1) {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData === null);
        } else {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData!.initialized);
        }
        searchIndex = nextIndex - 1;
      });
    });

    it("b->a, not on initializable index, ts = 128", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts128 * TICK_ARRAY_SIZE, [0, 50]);
      const ta2 = buildTickArrayData(ts128 * TICK_ARRAY_SIZE * 2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts128, false);
      let i = 0;
      let searchIndex = new TickArrayIndex(0, 25, ts128).toTickIndex() + 64;
      const expectedIndicies = [
        new TickArrayIndex(0, 32, ts128).toTickIndex(),
        new TickArrayIndex(0, 63, ts128).toTickIndex(),
        new TickArrayIndex(1, 0, ts128).toTickIndex(),
        new TickArrayIndex(1, 50, ts128).toTickIndex(),
        new TickArrayIndex(2, 25, ts128).toTickIndex(),
        new TickArrayIndex(2, 50, ts128).toTickIndex(),
        ta2.data!.startTickIndex + TICK_ARRAY_SIZE * ts128 - 1, // Last index in array 3
      ];

      expectedIndicies.forEach((expectedIndex, expectedResultIndex) => {
        const { nextIndex, nextTickData } = seq.findNextInitializedTickIndex(searchIndex)!;
        if (expectedResultIndex === expectedIndicies.length - 1) {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData === null);
        } else {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData!.initialized);
        }
        searchIndex = nextIndex;
      });
    });

    it("b->a, on initializable index, ts = 64", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * 2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, false);
      let i = 0;
      let searchIndex = new TickArrayIndex(0, 25, ts64).toTickIndex();
      const expectedIndicies = [
        new TickArrayIndex(0, 32, ts64).toTickIndex(),
        new TickArrayIndex(0, 63, ts64).toTickIndex(),
        new TickArrayIndex(1, 0, ts64).toTickIndex(),
        new TickArrayIndex(1, 50, ts64).toTickIndex(),
        new TickArrayIndex(2, 25, ts64).toTickIndex(),
        new TickArrayIndex(2, 50, ts64).toTickIndex(),
        ta2.data!.startTickIndex + TICK_ARRAY_SIZE * ts64 - 1, // Last index in array 3
      ];

      expectedIndicies.forEach((expectedIndex, expectedResultIndex) => {
        const { nextIndex, nextTickData } = seq.findNextInitializedTickIndex(searchIndex)!;
        if (expectedResultIndex === expectedIndicies.length - 1) {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData === null);
        } else {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData!.initialized);
        }
        searchIndex = nextIndex;
      });
    });

    it("b->a, on initializable index, ts = 64, currentTickIndex = -64, shifted", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * 2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, false);
      let i = 0;
      let searchIndex = -1 * ts64;
      const expectedIndicies = [
        new TickArrayIndex(0, 0, ts64).toTickIndex(),
        new TickArrayIndex(0, 32, ts64).toTickIndex(),
        new TickArrayIndex(0, 63, ts64).toTickIndex(),
        new TickArrayIndex(1, 0, ts64).toTickIndex(),
        new TickArrayIndex(1, 50, ts64).toTickIndex(),
        new TickArrayIndex(2, 25, ts64).toTickIndex(),
        new TickArrayIndex(2, 50, ts64).toTickIndex(),
        ta2.data!.startTickIndex + TICK_ARRAY_SIZE * ts64 - 1, // Last index in array 3
      ];

      expectedIndicies.forEach((expectedIndex, expectedResultIndex) => {
        const { nextIndex, nextTickData } = seq.findNextInitializedTickIndex(searchIndex)!;
        if (expectedResultIndex === expectedIndicies.length - 1) {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData === null);
        } else {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData!.initialized);
        }
        searchIndex = nextIndex;
      });
    });

    it("b->a, on initializable index, ts = 64, currentTickIndex = -1, shifted", async () => {
      const ta0 = buildTickArrayData(0, [0, 32, 63]);
      const ta1 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE, [0, 50]);
      const ta2 = buildTickArrayData(ts64 * TICK_ARRAY_SIZE * 2, [25, 50]);
      const seq = new TickArraySequence([ta0, ta1, ta2], ts64, false);
      let i = 0;
      let searchIndex = -1;
      const expectedIndicies = [
        new TickArrayIndex(0, 0, ts64).toTickIndex(),
        new TickArrayIndex(0, 32, ts64).toTickIndex(),
        new TickArrayIndex(0, 63, ts64).toTickIndex(),
        new TickArrayIndex(1, 0, ts64).toTickIndex(),
        new TickArrayIndex(1, 50, ts64).toTickIndex(),
        new TickArrayIndex(2, 25, ts64).toTickIndex(),
        new TickArrayIndex(2, 50, ts64).toTickIndex(),
        ta2.data!.startTickIndex + TICK_ARRAY_SIZE * ts64 - 1, // Last index in array 3
      ];

      expectedIndicies.forEach((expectedIndex, expectedResultIndex) => {
        const { nextIndex, nextTickData } = seq.findNextInitializedTickIndex(searchIndex)!;
        if (expectedResultIndex === expectedIndicies.length - 1) {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData === null);
        } else {
          assert.equal(nextIndex, expectedIndex);
          assert.ok(nextTickData!.initialized);
        }
        searchIndex = nextIndex;
      });
    });
  });
});
