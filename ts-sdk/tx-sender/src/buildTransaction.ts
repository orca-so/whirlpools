import {
  IInstruction,
  TransactionSigner,
  Address,
  compressTransactionMessageUsingAddressLookupTables,
  assertAccountDecoded,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  assertAccountExists,
  signTransactionMessageWithSigners,
  Rpc,
  SolanaRpcApi,
  FullySignedTransaction,
  TransactionWithLifetime,
  createNoopSigner,
} from "@solana/web3.js";
import { normalizeAddresses, rpcFromUrl } from "./compatibility";
import { fetchAllMaybeAddressLookupTable } from "@solana-program/address-lookup-table";
import { addPriorityInstructions } from "./priorityFees";
import { getPriorityConfig, getConnectionContext } from "./config";

/**
 * Builds and signs a transaction from the given instructions and configuration.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {TransactionSigner} feePayer - The signer that will pay for the transaction
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to compress the transaction
 *
 * @returns {Promise<Readonly<FullySignedTransaction & TransactionWithLifetime>>} A signed and encoded transaction
 *
 * @example
 * const instructions = [createATAix, createTransferSolInstruction];
 * const feePayer = wallet.publicKey;
 * const message = await buildTransaction(
 *   instructions,
 *   feePayer,
 * );
 */
async function buildTransaction(
  instructions: IInstruction[],
  feePayer: TransactionSigner | Address,
  lookupTableAddresses?: (Address | string)[]
): Promise<Readonly<FullySignedTransaction & TransactionWithLifetime>> {
  return buildTransactionMessage(
    instructions,
    !("address" in feePayer) ? createNoopSigner(feePayer) : feePayer,
    normalizeAddresses(lookupTableAddresses)
  );
}

async function buildTransactionMessage(
  instructions: IInstruction[],
  signer: TransactionSigner,
  lookupTableAddresses?: Address[]
) {
  const connectionContext = getConnectionContext();
  const transactionConfig = getPriorityConfig();
  const rpc = rpcFromUrl(connectionContext.rpcUrl);

  let message = await prepareTransactionMessage(instructions, rpc, signer);

  if (lookupTableAddresses?.length) {
    const lookupTableAccounts = await fetchAllMaybeAddressLookupTable(
      rpc,
      lookupTableAddresses
    );
    const tables = lookupTableAccounts.reduce(
      (prev, account) => {
        assertAccountExists(account);
        assertAccountDecoded(account);
        prev[account.address] = account.data.addresses;
        return prev;
      },
      {} as { [address: Address]: Address[] }
    );
    message = compressTransactionMessageUsingAddressLookupTables(
      message,
      tables
    );
  }

  return signTransactionMessageWithSigners(
    await addPriorityInstructions(
      message,
      transactionConfig,
      connectionContext,
      signer
    )
  );
}

async function prepareTransactionMessage(
  instructions: IInstruction[],
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner
) {
  const { value: blockhash } = await rpc
    .getLatestBlockhash({
      commitment: "confirmed",
    })
    .send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );
}

export { buildTransaction };
