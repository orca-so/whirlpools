import {
  address,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getPayer, getRpcConfig } from "./config";
import {
  rpcFromUrl,
  buildAndSendTransaction,
  buildTransaction,
} from "@orca-so/tx-sender";

/**
 * A generic wrapper function to reduce boilerplate when working with Whirlpool instructions
 * @param instructionFn The Whirlpool instruction function to execute
 * @returns A wrapped function that automatically includes rpc and owner params
 */
export function wrapFunctionWithExecution<T extends unknown[], R>(
  instructionFn: (
    rpc: Rpc<SolanaRpcApi>,
    ...params: [...T, TransactionSigner]
  ) => Promise<R & { instructions: Instruction[] }>,
): (...params: T) => Promise<R & { callback: () => Promise<Signature> }> {
  return async (...params: T) => {
    const { rpcUrl } = getRpcConfig();
    const rpc = rpcFromUrl(rpcUrl);
    const owner = getPayer();

    const result = await instructionFn(rpc, ...params, owner);

    return {
      ...result,
      callback: () => buildAndSendTransaction(result.instructions, owner),
    };
  };
}

/**
 * Check if adding additional instructions would exceed transaction size limits
 * @param currentInstructions Current list of instructions in transaction
 * @param instructionsToAdd Instructions to check if they can be added
 * @returns True if adding instructions would exceed size limit, false otherwise
 */
export async function wouldExceedTransactionSize(
  currentInstructions: Instruction[],
  instructionsToAdd: Instruction[],
): Promise<boolean> {
  const noopSginer = createNoopSigner(
    address("11111111111111111111111111111111"),
  );
  const tx = await buildTransaction(
    [...currentInstructions, ...instructionsToAdd],
    noopSginer,
  );
  const encodedTransaction = getBase64EncodedWireTransaction(tx);

  // The maximum size for a base64 encoded transaction is 1644 bytes
  // This is derived from PACKET_DATA_SIZE (1232) with base64 encoding overhead
  const TX_BASE64_ENCODED_SIZE_LIMIT = 1644;

  return encodedTransaction.length >= TX_BASE64_ENCODED_SIZE_LIMIT;
}
