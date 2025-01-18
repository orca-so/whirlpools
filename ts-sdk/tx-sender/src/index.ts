import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildTransaction,
  connection,
  getComputeUnitsForInstructions,
} from "./utils";
import { BaseSignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PrioritizationConfig } from "./types";

export const DEFAULT_PRIORITIZATION: PrioritizationConfig = {
  mode: "both",
  fee: {
    lamports: 4_000_000, // 0.004 SOL
    isExact: false, // dynamic
  },
};

export const buildTx = async (
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  connectionOrRpcUrl: Connection | string,
  priorityConfig: PrioritizationConfig = DEFAULT_PRIORITIZATION,
  signatures?: Array<Uint8Array>,
  lookupTables?: AddressLookupTableAccount[]
): Promise<VersionedTransaction> => {
  const cx = connection(connectionOrRpcUrl);
  const { blockhash } = await cx.getLatestBlockhash({
    commitment: "confirmed",
  });
  const computeUnits = await getComputeUnitsForInstructions(
    cx,
    instructions,
    feePayer,
    lookupTables
  );
  if (!computeUnits) throw Error("Tx simulation failed");
  return buildTransaction(
    instructions,
    blockhash,
    feePayer,
    priorityConfig,
    computeUnits,
    lookupTables,
    signatures
  );
};

export const signAndSendTransaction = async (
  transaction: VersionedTransaction | Transaction,
  wallet: Keypair | BaseSignerWalletAdapter,
  connectionOrRpcUrl: Connection | string
): Promise<string> => {
  const signed =
    wallet instanceof BaseSignerWalletAdapter
      ? await wallet.signTransaction(transaction)
      : (() => {
          if (transaction instanceof VersionedTransaction) {
            transaction.sign([wallet]);
          } else {
            transaction.sign(wallet);
          }
          return transaction;
        })();
  // TODO retry logic with backoff
  // TODO blockhash expiration handling
  return connection(connectionOrRpcUrl).sendRawTransaction(signed.serialize());
};

export const buildAndSendTransaction = async (
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  wallet: Keypair | BaseSignerWalletAdapter,
  connectionOrRpcUrl: Connection | string,
  priorityConfig: PrioritizationConfig = DEFAULT_PRIORITIZATION,
  lookupTables?: AddressLookupTableAccount[],
  signatures?: Array<Uint8Array>
): Promise<string> => {
  const tx = await buildTx(
    instructions,
    feePayer,
    connectionOrRpcUrl,
    priorityConfig,
    signatures,
    lookupTables
  );
  return signAndSendTransaction(tx, wallet, connectionOrRpcUrl);
};
