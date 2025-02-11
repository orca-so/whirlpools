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
 * Builds a compilable transaction message from the given instructions and configuration.
 *
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {Address | string} feePayer - The address of the account that will pay for the transaction
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses
 * @param {string} [rpcUrl] - Optional RPC URL for the Solana network
 * @param {boolean} [isTriton] - Optional flag to indicate if using Triton infrastructure
 * @param {TransactionConfig} [transactionConfig=DEFAULT_PRIORITIZATION] - Optional transaction configuration for priority fees
 *
 * @returns {Promise<CompilableTransactionMessage>} A promise that resolves to a compilable transaction message
 *
 * @example
 * const instructions = [createATAix, createTransferSolInstruction];
 * const feePayer = wallet.publicKey;
 * const message = await buildTransaction(
 *   instructions,
 *   feePayer,
 *   undefined,
 *   "https://api.mainnet-beta.solana.com",
 *   false,
 *   {
 *     jito: {
 *       type: "dynamic",
 *       maxCapLamports: 5_000_000,
 *     },
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
  lookupTableAddresses?: (Address | string)[],
  rpcUrl?: string,
  isTriton?: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION,
  additionalSigners?: TransactionSigner[]
) {
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

  if (lookupTableAddresses) {
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
