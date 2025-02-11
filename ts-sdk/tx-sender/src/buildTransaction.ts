import {
  IInstruction,
  TransactionSigner,
  prependTransactionMessageInstruction,
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
  addSignersToTransactionMessage,
  Rpc,
  SolanaRpcApi,
  FullySignedTransaction,
  TransactionWithLifetime,
} from "@solana/web3.js";
import { normalizeAddresses, rpcFromUrl } from "./compatibility";
import { getJitoTipAddress } from "./jito";
import { getTransferSolInstruction } from "@solana-program/system";
import { fetchAllMaybeAddressLookupTable } from "@solana-program/address-lookup-table";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { estimatePriorityFees } from "./priorityFees";
import {
  DEFAULT_PRIORITIZATION,
  getPriorityConfig,
  getConnectionContext,
  ConnectionContext,
  TransactionConfig,
} from "./config";

/**
 * Builds and signs a transaction from the given instructions and configuration.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {TransactionSigner} feePayer - The signer that will pay for the transaction
 * @param {TransactionConfig} [transactionConfig=DEFAULT_PRIORITIZATION] - Configuration for priority fees and Jito tips
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to compress the transaction
 * @param {TransactionSigner[]} [additionalSigners] - Optional array of additional transaction signers
 * @param {string} [rpcUrl] - Optional RPC URL to use for the transaction
 * @param {boolean} [isTriton] - Optional flag to indicate if using Triton RPC
 *
 * @returns {Promise<Readonly<FullySignedTransaction & TransactionWithLifetime>>} A signed and encoded transaction
 *
 * @example
 * const instructions = [createATAix, createTransferSolInstruction];
 * const feePayer = wallet.publicKey;
 * const message = await buildTransaction(
 *   instructions,
 *   feePayer,
 *   {
 *     // Add Jito tip for MEV extraction
 *     jito: {
 *       type: "dynamic",
 *       maxCapLamports: 5_000_000,
 *     },
 *     // Add priority fee for faster inclusion
 *     priorityFee: {
 *       type: "exact",
 *       amountLamports: 1_000_000,
 *     },
 *     chainId: "solana",
 *   }
 * );
 */
async function buildTransaction(
  instructions: IInstruction[],
  feePayer: TransactionSigner,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION,
  lookupTableAddresses?: (Address | string)[],
  additionalSigners?: TransactionSigner[],
  rpcUrl?: string,
  isTriton?: boolean
): Promise<Readonly<FullySignedTransaction & TransactionWithLifetime>> {
  return buildTransactionMessage(
    instructions,
    feePayer,
    getPriorityConfig(transactionConfig),
    getConnectionContext(rpcUrl, isTriton),
    normalizeAddresses(lookupTableAddresses),
    additionalSigners
  );
}

async function buildTransactionMessage(
  instructions: IInstruction[],
  signer: TransactionSigner,
  transactionConfig: TransactionConfig,
  connectionContext: ConnectionContext,
  lookupTableAddresses?: Address[],
  additionalSigners?: TransactionSigner[]
) {
  const { rpcUrl, isTriton } = connectionContext;
  const rpc = rpcFromUrl(rpcUrl);

  let message = await generateTransactionMessage(instructions, rpc, signer);

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

  const { priorityFeeMicroLamports, jitoTipLamports, computeUnits } =
    await estimatePriorityFees(
      instructions,
      signer,
      rpcUrl,
      !!isTriton,
      transactionConfig
    );

  if (jitoTipLamports > 0) {
    message = prependTransactionMessageInstruction(
      getTransferSolInstruction({
        source: signer,
        destination: getJitoTipAddress(),
        amount: jitoTipLamports,
      }),
      message
    );
  }

  if (priorityFeeMicroLamports > 0) {
    message = prependTransactionMessageInstruction(
      getSetComputeUnitPriceInstruction({
        microLamports: priorityFeeMicroLamports,
      }),
      message
    );
    message = prependTransactionMessageInstruction(
      getSetComputeUnitLimitInstruction({ units: computeUnits }),
      message
    );
  }

  if (additionalSigners) {
    message = addSignersToTransactionMessage(additionalSigners, message);
  }
  return signTransactionMessageWithSigners(message);
}

async function generateTransactionMessage(
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

export { buildTransaction, generateTransactionMessage };
