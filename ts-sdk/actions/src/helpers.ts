import type { IInstruction, TransactionSigner } from "@solana/kit";
import { getPayer, getRpcConfig } from "./config";
import { rpcFromUrl, buildAndSendTransaction } from "@orca-so/tx-sender";

/**
 * A generic wrapper function to reduce boilerplate when working with Whirlpool instructions
 * @param instructionFn The Whirlpool instruction function to execute
 * @param params Parameters for the instruction function (excluding rpc and owner)
 * @returns An object with callback and other relevant data
 */
export async function executeWhirlpoolInstruction<T extends any[], R>(
  instructionFn: (
    rpc: any,
    ...params: [...T, TransactionSigner]
  ) => Promise<R & { instructions: IInstruction[] }>,
  ...params: T
): Promise<R & { callback: () => Promise<string> }> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const result = await instructionFn(rpc, ...params, owner);

  return {
    ...result,
    callback: () => buildAndSendTransaction(result.instructions, owner),
  };
}

/**
 * Check if adding additional instructions would exceed transaction size limits
 * @param currentInstructions Current list of instructions in transaction
 * @param instructionsToAdd Instructions to check if they can be added
 * @returns True if adding instructions would exceed size limit, false otherwise
 */
export function wouldExceedTransactionSize(
  currentInstructions: IInstruction[],
  instructionsToAdd: IInstruction[],
): boolean {
  // Current Solana transaction size limit is 1232 bytes
  const MAX_TRANSACTION_SIZE = 1232;
  const INSTRUCTION_HEADER_SIZE = 3; // 1 byte for accounts length, 1 byte for data length, 1 byte for program id index
  const ACCOUNT_SIZE = 33; // 32 bytes for public key, 1 byte for is_signer/is_writable flags

  const totalSize = [...currentInstructions, ...instructionsToAdd].reduce(
    (sum, ix) => {
      let ixSize = INSTRUCTION_HEADER_SIZE;

      const numAccounts = (ix.accounts?.length ?? 0) + 1; // +1 for programAddress
      ixSize += numAccounts * ACCOUNT_SIZE;

      ixSize += ix.data?.length ?? 0;

      return sum + ixSize;
    },
    0,
  );

  return totalSize > MAX_TRANSACTION_SIZE;
}
