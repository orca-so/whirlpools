import { IInstruction } from "@solana/web3.js";

/**
 * Check if adding additional instructions would exceed transaction size limits
 * @param currentInstructions Current list of instructions in transaction
 * @param instructionsToAdd Instructions to check if they can be added
 * @returns True if adding instructions would exceed size limit, false otherwise
 */
export function wouldExceedTransactionSize(
  currentInstructions: IInstruction[],
  instructionsToAdd: IInstruction[]
): boolean {
  // Current Solana transaction size limit is 1232 bytes
  const MAX_TRANSACTION_SIZE = 1232;
  const INSTRUCTION_OVERHEAD = 40; // Each instruction has ~40 bytes overhead

  // Calculate total size in one pass
  const totalSize = [...currentInstructions, ...instructionsToAdd].reduce(
    (sum, ix) => sum + INSTRUCTION_OVERHEAD + (ix.data?.length ?? 0),
    0
  );

  return totalSize > MAX_TRANSACTION_SIZE;
}
