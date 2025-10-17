import { getRpcConfig } from "./config";
import type {
  Address,
  IInstruction,
  FullySignedTransaction,
  Signature,
  Commitment,
  TransactionWithLifetime,
  Transaction,
  KeyPairSigner,
  NoopSigner,
} from "@solana/kit";
import {
  assertTransactionIsFullySigned,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
} from "@solana/kit";
import { rpcFromUrl } from "./compatibility";
import { buildTransaction } from "./buildTransaction";

/**
 * Builds and sends a transaction with the given instructions, signers, and commitment level.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction.
 * @param {TransactionSigner} payer - The fee payer for the transaction (must be the SAME instance used to build instructions).
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to use.
 * @param {Commitment} [commitment="confirmed"] - The commitment level for transaction confirmation.
 *
 * @returns {Promise<Signature>} A promise that resolves to the transaction signature.
 *
 * @throws {Error} If transaction building or sending fails.
 *
 * @example
 * ```ts
 * // With KeyPairSigner (Node.js) - fully signed and sent
 * const { instructions } = await swapInstructions(rpc, params, pool, 100, keypairSigner);
 * const signature = await buildAndSendTransaction(instructions, keypairSigner);
 * ```
 */
export async function buildAndSendTransaction(
  instructions: IInstruction[],
  payer: KeyPairSigner | NoopSigner,
  lookupTableAddresses?: (Address | string)[],
  commitment: Commitment = "confirmed",
): Promise<Signature> {
  const tx = await buildTransaction(instructions, payer, lookupTableAddresses);
  return sendTransaction(tx, commitment);
}

/**
 * Sends a signed transaction message to the Solana network with a specified commitment level.
 * Asserts that the transaction is fully signed before sending.
 *
 * @param {(FullySignedTransaction | Transaction) & TransactionWithLifetime} transaction - The transaction to send (will be asserted as fully signed).
 * @param {Commitment} [commitment="confirmed"] - The commitment level for transaction confirmation.
 *
 * @returns {Promise<Signature>} A promise that resolves to the transaction signature.
 *
 * @throws {Error} If transaction is missing signatures, sending fails, the RPC connection fails, or the transaction expires.
 *
 * @example
 * ```ts
 * // With KeyPairSigner (Node.js) - already fully signed
 * const tx = await buildTransaction(instructions, keypairSigner);
 * const signature = await sendTransaction(tx, "confirmed");
 *
 * // With wallet signature (browser)
 * const partialTx = await buildTransaction(instructions, noopSigner);
 * const [signedTx] = await wallet.modifyAndSignTransactions([partialTx]);
 * const signature = await sendTransaction(signedTx, "confirmed");
 * ```
 */
export async function sendTransaction(
  transaction: (FullySignedTransaction | Transaction) & TransactionWithLifetime,
  commitment: Commitment = "confirmed",
): Promise<Signature> {
  assertTransactionIsFullySigned(transaction);

  const { rpcUrl, pollIntervalMs, resendOnPoll } = getRpcConfig();
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

  // Send the transaction (skip preflight since we already simulated)
  const sendTx = async () => {
    await rpc
      .sendTransaction(encodedTransaction, {
        skipPreflight: true,
        encoding: "base64",
        ...(resendOnPoll && { maxRetries: BigInt(0) }),
      })
      .send();
  };

  try {
    await sendTx();
  } catch (error) {
    throw new Error(`Failed to send transaction: ${error}`);
  }

  const expiryTime = Date.now() + 90_000;

  while (Date.now() < expiryTime) {
    const iterationStart = Date.now();

    try {
      const { value } = await rpc.getSignatureStatuses([txHash]).send();
      const status = value[0];

      if (status?.confirmationStatus === commitment) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        return txHash;
      }
    } catch {
      // Continue polling even on RPC errors
    }

    if (resendOnPoll) {
      try {
        await sendTx();
      } catch {
        // Ignore resend errors, continue polling
      }
    }

    if (pollIntervalMs > 0) {
      const elapsed = Date.now() - iterationStart;
      const remainingDelay = pollIntervalMs - elapsed;
      if (remainingDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingDelay));
      }
    }
  }

  throw new Error("Transaction confirmation timeout");
}

function getTxHash(transaction: FullySignedTransaction) {
  const [signature] = Object.values(transaction.signatures);
  const txHash = getBase58Decoder().decode(signature!) as Signature;
  return txHash;
}
