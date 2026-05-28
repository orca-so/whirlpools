import type { Instruction } from "@solana/kit";

/**
 * Predicate used by {@link packIntoTransactionSets} to decide when to flush
 * the current batch.
 */
export type SizeExceedsPredicate = (
  current: Instruction[],
  next: Instruction[],
) => Promise<boolean>;

/**
 * Pack instructions for a sequence of items into transaction-sized batches.
 *
 * For each item, fetch its instructions and append them to the current batch.
 * If appending would exceed the transaction size limit, the current batch is
 * finalised and a new batch is started with that item's instructions. After
 * the loop, the trailing batch is always flushed if non-empty.
 *
 * Items whose `buildInstructions` returns an empty list are skipped — they
 * neither start a new batch nor trigger a flush.
 */
export async function packIntoTransactionSets<T>(
  items: readonly T[],
  buildInstructions: (item: T) => Promise<Instruction[]>,
  sizeExceeds: SizeExceedsPredicate,
): Promise<Instruction[][]> {
  const sets: Instruction[][] = [];
  let current: Instruction[] = [];
  for (const item of items) {
    const next = await buildInstructions(item);
    if (next.length === 0) {
      continue;
    }
    if (current.length > 0 && (await sizeExceeds(current, next))) {
      sets.push(current);
      current = [...next];
    } else {
      current.push(...next);
    }
  }
  if (current.length > 0) {
    sets.push(current);
  }
  return sets;
}
