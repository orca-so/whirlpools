import type {
  AddressLookupTableAccount,
  Connection,
  RecentPrioritizationFees,
} from "@solana/web3.js";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Instruction } from "./types";
import BN from "bn.js";

export const MICROLAMPORTS_PER_LAMPORT = 1_000_000;
export const DEFAULT_PRIORITY_FEE_PERCENTILE = 0.9;
export const DEFAULT_MAX_PRIORITY_FEE_LAMPORTS = 1000000; // 0.001 SOL
export const DEFAULT_MIN_PRIORITY_FEE_LAMPORTS = 0; // 0 SOL
export const DEFAULT_MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

export async function estimateComputeBudgetLimit(
  connection: Connection,
  instructions: Instruction[],
  lookupTableAccounts: AddressLookupTableAccount[] | undefined,
  payer: PublicKey,
  margin: number,
): Promise<number> {
  try {
    const txMainInstructions = instructions.flatMap(
      (instruction) => instruction.instructions,
    );
    const txCleanupInstruction = instructions.flatMap(
      (instruction) => instruction.cleanupInstructions,
    );
    const txMessage = new TransactionMessage({
      recentBlockhash: PublicKey.default.toBase58(),
      payerKey: payer,
      instructions: [...txMainInstructions, ...txCleanupInstruction],
    }).compileToV0Message(lookupTableAccounts);

    const tx = new VersionedTransaction(txMessage);

    const simulation = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (!simulation.value.unitsConsumed) {
      return DEFAULT_MAX_COMPUTE_UNIT_LIMIT;
    }
    const marginUnits = Math.max(
      100_000,
      margin * simulation.value.unitsConsumed,
    );
    const estimatedUnits = Math.ceil(
      simulation.value.unitsConsumed + marginUnits,
    );
    return Math.min(DEFAULT_MAX_COMPUTE_UNIT_LIMIT, estimatedUnits);
  } catch {
    return DEFAULT_MAX_COMPUTE_UNIT_LIMIT;
  }
}

export async function getPriorityFeeInLamports(
  connection: Connection,
  computeBudgetLimit: number,
  lockedWritableAccounts: PublicKey[],
  percentile: number = DEFAULT_PRIORITY_FEE_PERCENTILE,
  getRecentPrioritizationFees?: (
    lockedWritableAccounts: PublicKey[],
  ) => Promise<RecentPrioritizationFees[]>,
): Promise<number> {
  const recentPriorityFees = await (getRecentPrioritizationFees
    ? getRecentPrioritizationFees(lockedWritableAccounts)
    : connection.getRecentPrioritizationFees({
        lockedWritableAccounts,
      }));
  const priorityFee = getPriorityFeeSuggestion(recentPriorityFees, percentile);
  return (priorityFee * computeBudgetLimit) / MICROLAMPORTS_PER_LAMPORT;
}

function getPriorityFeeSuggestion(
  recentPriorityFees: RecentPrioritizationFees[],
  percentile: number,
): number {
  // Take the Xth percentile of all the slots returned
  const sortedPriorityFees = recentPriorityFees.sort(
    (a, b) => a.prioritizationFee - b.prioritizationFee,
  );
  const percentileIndex = Math.min(
    Math.max(Math.floor(sortedPriorityFees.length * percentile), 0),
    sortedPriorityFees.length - 1,
  );
  return sortedPriorityFees[percentileIndex].prioritizationFee;
}

export function getLockWritableAccounts(
  instructions: Instruction[],
): PublicKey[] {
  return instructions
    .flatMap((instruction) => [
      ...instruction.instructions,
      ...instruction.cleanupInstructions,
    ])
    .flatMap((instruction) => instruction.keys)
    .filter((key) => key.isWritable)
    .map((key) => key.pubkey);
}

const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_INSTRUCTION_DISCRIMINATOR =
  Buffer.from([0x04]);
export function setLoadedAccountsDataSizeLimitInstruction(
  dataSizeLimit: BN | number,
): TransactionInstruction {
  const dataSizeLimitBn = new BN(dataSizeLimit);
  return new TransactionInstruction({
    programId: ComputeBudgetProgram.programId,
    data: Buffer.concat([
      SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_INSTRUCTION_DISCRIMINATOR,
      dataSizeLimitBn.toArrayLike(Buffer, "le", 4),
    ]),
    keys: [],
  });
}
