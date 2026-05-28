import type { Instruction } from "@solana/kit";
import assert from "assert";
import { describe, it } from "vitest";
import { packIntoTransactionSets } from "../src/transactionBatching";

const ix = (id: string): Instruction =>
  ({ programAddress: id }) as unknown as Instruction;

describe("packIntoTransactionSets", () => {
  it("returns an empty array when there are no items", async () => {
    const sets = await packIntoTransactionSets<string>(
      [],
      async () => [],
      async () => false,
    );
    assert.deepStrictEqual(sets, []);
  });

  it("returns a single batch when nothing exceeds the limit", async () => {
    const sets = await packIntoTransactionSets(
      ["a", "b", "c"],
      async (item) => [ix(item)],
      async () => false,
    );
    assert.deepStrictEqual(sets, [[ix("a"), ix("b"), ix("c")]]);
  });

  it("flushes the trailing batch after a split (regression for #1298)", async () => {
    // Predicate fires once between items 2 and 3, then never again.
    let calls = 0;
    const sets = await packIntoTransactionSets(
      ["a", "b", "c", "d"],
      async (item) => [ix(item)],
      async () => {
        calls += 1;
        return calls === 2;
      },
    );
    assert.deepStrictEqual(sets, [
      [ix("a"), ix("b")],
      [ix("c"), ix("d")],
    ]);
  });

  it("never pushes an empty batch when the first item alone would overflow", async () => {
    // A predicate that always returns true would, without the guard, push an
    // empty `current` batch on the first iteration.
    const sets = await packIntoTransactionSets(
      ["a", "b"],
      async (item) => [ix(item)],
      async () => true,
    );
    assert.deepStrictEqual(sets, [[ix("a")], [ix("b")]]);
    for (const set of sets) {
      assert.ok(set.length > 0, "no empty batches should be emitted");
    }
  });

  it("skips items whose buildInstructions returns an empty list", async () => {
    const sets = await packIntoTransactionSets(
      ["a", "skip", "b"],
      async (item) => (item === "skip" ? [] : [ix(item)]),
      async () => false,
    );
    assert.deepStrictEqual(sets, [[ix("a"), ix("b")]]);
  });

  it("splits into many batches and includes every item exactly once", async () => {
    // Predicate returns true every other call to force frequent splits.
    let calls = 0;
    const items = ["a", "b", "c", "d", "e"];
    const sets = await packIntoTransactionSets(
      items,
      async (item) => [ix(item)],
      async () => {
        calls += 1;
        return calls % 2 === 0;
      },
    );
    const flattened = sets.flat().map((i) => i.programAddress);
    assert.deepStrictEqual(flattened, items);
    for (const set of sets) {
      assert.ok(set.length > 0);
    }
  });
});
