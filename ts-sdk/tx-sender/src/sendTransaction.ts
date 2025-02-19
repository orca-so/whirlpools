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
 * const signature = await buildAndSendTransaction(
 *   instructions,
 *   keypairSigner,
 *   lookupTables,
 * );
 */
export async function buildAndSendTransaction(
  instructions: IInstruction[],
  payer: KeyPairSigner,
  lookupTableAddresses?: (Address | string)[]
) {
  const tx = await buildTransaction(instructions, payer, lookupTableAddresses);
  assertTransactionIsFullySigned(tx);
  return sendSignedTransaction(tx);
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
export async function sendSignedTransaction(
  transaction: FullySignedTransaction
) {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const txHash = getTxHash(transaction);
  const encodedTransaction = getBase64EncodedWireTransaction(transaction);

  await rpc
    .sendTransaction(encodedTransaction, {
      maxRetries: BigInt(0),
      skipPreflight: true,
      encoding: "base64",
    })
    .send();
  return txHash;
}

function getTxHash(transaction: FullySignedTransaction) {
  const [signature] = Object.values(transaction.signatures);
  const txHash = getBase58Decoder().decode(signature!) as Signature;
  return txHash;
}
