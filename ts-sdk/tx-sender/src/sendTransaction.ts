import { getRpcConfig } from "./config";
import type {
  Address,
  Instruction,
  FullySignedTransaction,
  Signature,
  Commitment,
  Transaction,
  TransactionWithLifetime,
  TransactionSigner,
} from "@solana/kit";
import {
  assertIsFullySignedTransaction,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
} from "@solana/kit";
import { rpcFromUrl } from "./compatibility";
import { buildTransaction } from "./buildTransaction";

/**
 * Builds and sends a transaction with the given instructions, signers, and commitment level.
 *
 * @param {Instruction[]} instructions - Array of instructions to include in the transaction.
 * @param {TransactionSigner} payer - The fee payer for the transaction.
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to use.
 * @param {Commitment} [commitment="confirmed"] - The commitment level for transaction confirmation.
 *
 * @returns {Promise<Signature>} A promise that resolves to the transaction signature.
 *
 * @throws {Error} If transaction building or sending fails.
 *
 * @example
 * ```ts
 * const signature = await buildAndSendTransaction(
 *   instructions,
 *   keypairSigner,
 *   lookupTables,
 *   "finalized"
 * );
 * ```
 */
export async function buildAndSendTransaction(
  instructions: Instruction[],
  payer: TransactionSigner,
  lookupTableAddresses?: (Address | string)[],
  commitment: Commitment = "confirmed",
) {
  const tx = await buildTransaction(instructions, payer, lookupTableAddresses);
  assertIsFullySignedTransaction(tx);
  return sendTransaction(tx, commitment);
}

/**
 * Sends a signed transaction message to the Solana network with a specified commitment level.
 *
 * @param {FullySignedTransaction} transaction - The fully signed transaction to send.
 * @param {Commitment} [commitment="confirmed"] - The commitment level for transaction confirmation.
 *
 * @returns {Promise<Signature>} A promise that resolves to the transaction signature.
 *
 * @throws {Error} If transaction sending fails, the RPC connection fails, or the transaction expires.
 *
 * @example
 * ```ts
 * assertIsFullySignedTransaction(signedTransaction);
 *
 * const signature = await sendTransaction(
 *   signedTransaction,
 *   "finalized"
 * );
 * ```
 */
export async function sendTransaction(
  transaction: Transaction & FullySignedTransaction & TransactionWithLifetime,
  commitment: Commitment = "confirmed",
): Promise<Signature> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const txHash = getTxHash(transaction);
  const encodedTransaction = getBase64EncodedWireTransaction(transaction);

  // Simulate transaction first
  const simResult = await rpc
    .simulateTransaction(encodedTransaction, {
      encoding: "base64",
    })
    .send();

  if (simResult.value.err) {
    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(
        simResult.value.err,
        (key, value) => (typeof value === "bigint" ? value.toString() : value),
      )}`,
    );
  }

  const expiryTime = Date.now() + 90_000;

  while (Date.now() < expiryTime) {
    try {
      await rpc
        .sendTransaction(encodedTransaction, {
          maxRetries: BigInt(0),
          skipPreflight: true,
          encoding: "base64",
        })
        .send();

      const { value } = await rpc.getSignatureStatuses([txHash]).send();
      const status = value[0];
      if (status?.confirmationStatus === commitment) {
        if (status.err) {
          throw new Error(`Transaction failed: ${status.err}`);
        }
        return txHash;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Transaction expired");
}

function getTxHash(transaction: Transaction & FullySignedTransaction) {
  const [signature] = Object.values(transaction.signatures);
  const txHash = getBase58Decoder().decode(signature!) as Signature;
  return txHash;
}
