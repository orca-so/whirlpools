import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { BaseSignerWalletAdapter } from "@solana/wallet-adapter-base";
import { TransactionConfig } from "./types";
import {
  buildTransaction,
  DEFAULT_PRIORITIZATION,
  signAndSendTransaction,
} from "./functions";
import { getConnection, getPriorityConfig, setGlobalConfig } from "./config";

export const init = (config: {
  connection: Connection;
  transactionConfig?: TransactionConfig;
  isTriton?: boolean;
}) => {
  setGlobalConfig(config);
};

export const buildTx = async (
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  signatures?: Array<Uint8Array>,
  lookupTables?: AddressLookupTableAccount[],
  connectionOrRpcUrl?: Connection | string,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<VersionedTransaction> => {
  const connection = getConnection(connectionOrRpcUrl);
  const transactionSettings = getPriorityConfig(transactionConfig);
  return buildTransaction(
    instructions,
    feePayer,
    connection,
    transactionSettings,
    lookupTables,
    signatures
  );
};

export const buildAndSendTransaction = async (
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  wallet: Keypair | BaseSignerWalletAdapter,
  lookupTables?: AddressLookupTableAccount[],
  signatures?: Array<Uint8Array>,
  connectionOrRpcUrl?: Connection | string,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<string> => {
  const { connection, isTriton } = getConnection(connectionOrRpcUrl);
  const transactionSettings = getPriorityConfig(transactionConfig);
  const tx = await buildTransaction(
    instructions,
    feePayer,
    { connection, isTriton },
    transactionSettings,
    lookupTables,
    signatures
  );
  return signAndSendTransaction(tx, wallet, connection);
};
