import { TransactionConfig } from "./types";
import { buildTransaction, DEFAULT_PRIORITIZATION } from "./functions";
import {
  getConnectionContext,
  getPriorityConfig,
  setGlobalConfig,
} from "./config";
import {
  IInstruction,
  KeyPairSigner,
  TransactionMessage,
  TransactionSigner,
} from "@solana/web3.js";

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
  // todo figure out the signing flow
  console.log(tx);
};
