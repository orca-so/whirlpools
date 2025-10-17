import type {
  IInstruction,
  TransactionSigner,
  Address,
  Rpc,
  SolanaRpcApi,
  FullySignedTransaction,
  TransactionWithLifetime,
  Transaction,
} from "@solana/kit";
import {
  compressTransactionMessageUsingAddressLookupTables,
  assertAccountDecoded,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  partiallySignTransactionMessageWithSigners,
} from "@solana/kit";
import { normalizeAddresses, rpcFromUrl } from "./compatibility";
import { fetchAllMaybeAddressLookupTable } from "@solana-program/address-lookup-table";
import { addPriorityInstructions } from "./priorityFees";
import { getRpcConfig } from "./config";

/**
 * Builds and signs a transaction from the given instructions and configuration.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {TransactionSigner} feePayer - The signer that will pay for the transaction (must be the SAME instance used to build instructions)
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to compress the transaction
 *
 * @returns {Promise<Readonly<(FullySignedTransaction | Transaction) & TransactionWithLifetime>>}
 *   - FullySignedTransaction if feePayer is a KeyPairSigner (has keyPair property)
 *   - Transaction (partially signed) if feePayer is NoopSigner (no keyPair property)
 *
 * @example
 * // Node.js with KeyPairSigner - fully signed automatically
 * const { instructions } = await swapInstructions(rpc, params, pool, 100, keypairSigner);
 * const tx = await buildTransaction(instructions, keypairSigner);
 * await sendTransaction(tx);
 *
 * // Browser with NoopSigner - partially signed, wallet signs separately
 * const noopSigner = createNoopSigner(walletAddress);
 * const { instructions } = await swapInstructions(rpc, params, pool, 100, noopSigner);
 * const partialTx = await buildTransaction(instructions, noopSigner); // Same instance!
 * const [signedTx] = await wallet.modifyAndSignTransactions([partialTx]);
 * await sendTransaction(signedTx);
 */
export async function buildTransaction(
  instructions: IInstruction[],
  feePayer: TransactionSigner,
  lookupTableAddresses?: (Address | string)[],
): Promise<
  Readonly<(FullySignedTransaction | Transaction) & TransactionWithLifetime>
> {
  return buildTransactionMessage(
    instructions,
    feePayer,
    normalizeAddresses(lookupTableAddresses),
  );
}

async function buildTransactionMessage(
  instructions: IInstruction[],
  feePayer: TransactionSigner,
  lookupTableAddresses?: Address[],
) {
  const hasKeyPair = "keyPair" in feePayer;
  const usePartialSigning = !hasKeyPair;

  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);

  let message = await prepareTransactionMessage(instructions, rpc, feePayer);

  if (lookupTableAddresses?.length) {
    const lookupTableAccounts = await fetchAllMaybeAddressLookupTable(
      rpc,
      lookupTableAddresses,
    );
    const tables = lookupTableAccounts.reduce(
      (prev, account) => {
        if (account.exists) {
          assertAccountDecoded(account);
          prev[account.address] = account.data.addresses;
        }
        return prev;
      },
      {} as { [address: Address]: Address[] },
    );
    message = compressTransactionMessageUsingAddressLookupTables(
      message,
      tables,
    );
  }

  const messageWithPriorityFees = await addPriorityInstructions(
    message,
    feePayer,
  );

  if (usePartialSigning) {
    const partiallySigned = await partiallySignTransactionMessageWithSigners(
      messageWithPriorityFees,
    );
    return partiallySigned;
  }

  const signed = await signTransactionMessageWithSigners(
    messageWithPriorityFees,
  );
  return signed;
}

async function prepareTransactionMessage(
  instructions: IInstruction[],
  rpc: Rpc<SolanaRpcApi>,
  feePayer: TransactionSigner,
) {
  const { value: blockhash } = await rpc
    .getLatestBlockhash({
      commitment: "confirmed",
    })
    .send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
}
