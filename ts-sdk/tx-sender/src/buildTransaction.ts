import type {
  Instruction,
  Address,
  Rpc,
  SolanaRpcApi,
  NoopSigner,
  KeyPairSigner,
  Transaction,
  TransactionWithLifetime,
} from "@solana/kit";
import {
  compressTransactionMessageUsingAddressLookupTables,
  assertAccountDecoded,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageLifetimeUsingBlockhash,
  partiallySignTransactionMessageWithSigners,
  setTransactionMessageFeePayerSigner,
} from "@solana/kit";
import { normalizeAddresses, rpcFromUrl } from "./compatibility";
import { fetchAllMaybeAddressLookupTable } from "@solana-program/address-lookup-table";
import { addPriorityInstructions } from "./priorityFees";
import type {
  BuildTransactionConfig,
  ComputeUnitLimitStrategy,
} from "./config";
import { getRpcConfig } from "./config";

/**
 * Builds and signs a transaction from the given instructions and configuration.
 *
 * @param {Instruction[]} instructions - Array of instructions to include in the transaction
 * @param {KeyPairSigner | NoopSigner} feePayer - The signer that will pay for the transaction (must be the SAME instance used to build instructions)
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to compress the transaction
 *
 * @returns {Promise<Readonly<Transaction & TransactionWithLifetime>>}
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
  instructions: Instruction[],
  feePayer: KeyPairSigner | NoopSigner,
  lookupTableAddresses?: (Address | string)[],
): Promise<Readonly<Transaction & TransactionWithLifetime>> {
  return buildTransactionMessage(
    instructions,
    feePayer,
    normalizeAddresses(lookupTableAddresses),
  );
}

/**
 * Builds and signs a transaction using explicit configuration instead of global settings.
 *
 * @param {Instruction[]} instructions - Array of instructions to include in the transaction
 * @param {KeyPairSigner | NoopSigner} feePayer - The signer that will pay for the transaction
 * @param {BuildTransactionConfig} config - Explicit configuration for RPC, fees, and compute units
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses
 *
 * @returns {Promise<Readonly<Transaction & TransactionWithLifetime>>}
 *
 * @example
 * // Use exact compute units to skip simulation
 * const tx = await buildTransactionWithConfig(instructions, keypairSigner, {
 *   rpcConfig: { rpcUrl: "https://api.mainnet-beta.solana.com", ... },
 *   computeUnitLimitStrategy: { type: "exact", units: 200_000 },
 * });
 *
 * // Use dynamic compute units (simulation)
 * const tx = await buildTransactionWithConfig(instructions, keypairSigner, {
 *   rpcConfig: { rpcUrl: "https://api.mainnet-beta.solana.com", ... },
 *   computeUnitLimitStrategy: { type: "dynamic" },
 * });
 */
export async function buildTransactionWithConfig(
  instructions: Instruction[],
  feePayer: KeyPairSigner | NoopSigner,
  config: BuildTransactionConfig,
  lookupTableAddresses?: (Address | string)[],
): Promise<Readonly<Transaction & TransactionWithLifetime>> {
  return buildTransactionMessageWithConfig(
    instructions,
    feePayer,
    config,
    normalizeAddresses(lookupTableAddresses),
  );
}

async function buildTransactionMessage(
  instructions: Instruction[],
  feePayer: KeyPairSigner | NoopSigner,
  lookupTableAddresses?: Address[],
  computeUnitLimitStrategy?: ComputeUnitLimitStrategy,
) {
  const rpcConfig = getRpcConfig();
  return buildTransactionMessageWithConfig(
    instructions,
    feePayer,
    {
      rpcConfig,
      computeUnitLimitStrategy,
    },
    lookupTableAddresses,
  );
}

async function buildTransactionMessageWithConfig(
  instructions: Instruction[],
  feePayer: KeyPairSigner | NoopSigner,
  config: BuildTransactionConfig,
  lookupTableAddresses?: Address[],
) {
  const rpc = rpcFromUrl(config.rpcConfig.rpcUrl);

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
    config.computeUnitLimitStrategy,
  );

  return await partiallySignTransactionMessageWithSigners(
    messageWithPriorityFees,
  );
}

async function prepareTransactionMessage(
  instructions: Instruction[],
  rpc: Rpc<SolanaRpcApi>,
  feePayer: KeyPairSigner | NoopSigner,
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
