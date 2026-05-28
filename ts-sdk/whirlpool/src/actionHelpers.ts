import {
  address,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type KeyPairSigner,
} from "@solana/kit";
import { getPayer, getRpcConfig } from "./config";
import {
  rpcFromUrl,
  buildAndSendTransaction,
  buildTransaction,
} from "@orca-so/tx-sender";

/**
 * Result returned by wrapped Whirlpool actions.
 *
 * Combines the instructions result with a `callback` that builds and sends
 * the transaction.
 */
export type ActionResult<R> = R & {
  callback: (payer?: KeyPairSigner) => Promise<Signature>;
};

/**
 * Helper that fetches the configured RPC and wires up the
 * `callback` for sending the resulting instructions.
 *
 * Use this from each action wrapper to avoid duplicating the boilerplate.
 */
export async function executeWithCallback<
  R extends { instructions: Instruction[] },
>(build: (rpc: Rpc<SolanaRpcApi>) => Promise<R>): Promise<ActionResult<R>> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const result = await build(rpc);
  return {
    ...result,
    callback: (payer?: KeyPairSigner) => {
      let funder = payer ?? getPayer();
      return buildAndSendTransaction(result.instructions, funder);
    },
  };
}

/**
 * Check if adding additional instructions would exceed transaction size limits.
 * @param currentInstructions Current list of instructions in transaction
 * @param instructionsToAdd Instructions to check if they can be added
 * @returns True if adding instructions would exceed size limit, false otherwise
 */
export async function wouldExceedTransactionSize(
  currentInstructions: Instruction[],
  instructionsToAdd: Instruction[],
): Promise<boolean> {
  const noopSigner = createNoopSigner(
    address("11111111111111111111111111111111"),
  );
  const tx = await buildTransaction(
    [...currentInstructions, ...instructionsToAdd],
    noopSigner,
  );
  const encodedTransaction = getBase64EncodedWireTransaction(tx);

  // The maximum size for a base64 encoded transaction is 1644 bytes
  // This is derived from PACKET_DATA_SIZE (1232) with base64 encoding overhead
  const TX_BASE64_ENCODED_SIZE_LIMIT = 1644;

  return encodedTransaction.length >= TX_BASE64_ENCODED_SIZE_LIMIT;
}

export {
  packIntoTransactionSets,
  type SizeExceedsPredicate,
} from "./transactionBatching";
