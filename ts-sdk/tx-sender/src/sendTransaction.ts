import { getRpcConfig } from "./config";
import {
  Address,
  assertTransactionIsFullySigned,
  getBase64EncodedWireTransaction,
  IInstruction,
  KeyPairSigner,
  FullySignedTransaction,
  Signature,
  getBase58Decoder,
  Commitment,
} from "@solana/web3.js";
import { rpcFromUrl } from "./compatibility";
import { buildTransaction } from "./buildTransaction";

/**
 * Builds and sends a transaction with the given instructions and signers.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {KeyPairSigner} payer - The fee payer for the transaction
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to use
 *
 * @returns {Promise<string>} A promise that resolves to the transaction signature
 *
 * @throws {Error} If transaction building or sending fails
 *
 * @example
 * await buildAndSendTransaction(
 *   instructions,
 *   keypairSigner,
 *   lookupTables,
 * );
 */

export async function buildAndSendTransaction(
  instructions: IInstruction[],
  payer: KeyPairSigner,
  lookupTableAddresses?: (Address | string)[],
  commitment: Commitment = "confirmed"
) {
  const tx = await buildTransaction(instructions, payer, lookupTableAddresses);
  assertTransactionIsFullySigned(tx);
  return sendTransaction(tx, commitment);
}

/**
 * Sends a signed transaction message to the Solana network.
 *
 * @param {FullySignedTransaction} transaction - The fully signed transaction to send
 *
 * @returns {Promise<string>} A promise that resolves to the transaction signature
 *
 * @throws {Error} If transaction sending fails or RPC connection fails
 *
 * @example
 * assertTransactionIsFullySigned(signedTransaction);
 *
 * const signature = await sendSignedTransaction(
 *   signedTransaction,
 * );
 */
export async function sendTransaction(
  transaction: FullySignedTransaction,
  commitment: Commitment = "confirmed"
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
    throw new Error(`Transaction simulation failed: ${simResult.value.err}`);
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

      if (value[0]?.confirmationStatus === commitment) {
        return txHash;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Transaction expired");
}

function getTxHash(transaction: FullySignedTransaction) {
  const [signature] = Object.values(transaction.signatures);
  const txHash = getBase58Decoder().decode(signature!) as Signature;
  return txHash;
}
