import { TransactionConfig } from "./types";
import { buildTransaction, DEFAULT_PRIORITIZATION } from "./functions";
import {
  getConnectionContext,
  getPriorityConfig,
  setGlobalConfig,
} from "./config";
import {
  addSignersToTransactionMessage,
  assertIsTransactionMessageWithBlockhashLifetime,
  assertTransactionIsFullySigned,
  getBase64EncodedWireTransaction,
  IInstruction,
  KeyPairSigner,
  signTransactionMessageWithSigners,
  TransactionMessage,
  TransactionSigner,
} from "@solana/web3.js";
import { connection } from "./utils";

export const init = (config: {
  rpcUrl: string;
  transactionConfig?: TransactionConfig;
  isTriton?: boolean;
}) => {
  setGlobalConfig(config);
};

export const buildTx = async (
  instructions: IInstruction[],
  signer: TransactionSigner,
  rpcUrl?: string,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION,
  isTriton?: boolean
): Promise<TransactionMessage> => {
  const connectionCtx = getConnectionContext(rpcUrl, isTriton);
  const transactionSettings = getPriorityConfig(transactionConfig);
  return buildTransaction(
    instructions,
    signer,
    transactionSettings,
    connectionCtx
  );
};

export const buildAndSendTransaction = async (
  instructions: IInstruction[],
  signer: KeyPairSigner,
  rpcUrl?: string,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
) => {
  const connectionCtx = getConnectionContext(rpcUrl);
  const transactionSettings = getPriorityConfig(transactionConfig);
  const tx = await buildTransaction(
    instructions,
    signer,
    transactionSettings,
    connectionCtx
  );
  assertIsTransactionMessageWithBlockhashLifetime(tx);
  const withSigners = addSignersToTransactionMessage([signer], tx);
  const signed = await signTransactionMessageWithSigners(withSigners);
  const rpc = connection(connectionCtx.rpcUrl);
  assertTransactionIsFullySigned(signed);
  const encodedTransaction = getBase64EncodedWireTransaction(signed);
  const transactionSignature = await rpc
    .sendTransaction(encodedTransaction)
    .send();
  return transactionSignature;
};
