import { PublicKey, TransactionConfig } from "./types";
import { buildTransaction } from "./functions";
import {
  DEFAULT_PRIORITIZATION,
  getConnectionContext,
  getPriorityConfig,
  setGlobalConfig,
} from "./config";
import {
  Address,
  addSignersToTransactionMessage,
  assertIsTransactionMessageWithBlockhashLifetime,
  assertTransactionIsFullySigned,
  getBase64EncodedWireTransaction,
  IInstruction,
  KeyPairSigner,
  signTransactionMessageWithSigners,
  TransactionMessage,
} from "@solana/web3.js";
import {
  connection,
  createFeePayerSigner,
  normalizeAddresses,
  normalizeInstructions,
} from "./utils";
import { TransactionInstruction } from "@solana/web3.js/src/transaction/legacy";

export const init = (config: {
  rpcUrl: string;
  transactionConfig?: TransactionConfig;
  isTriton?: boolean;
}) => {
  setGlobalConfig(config);
};

export const buildTx = async (
  instructions: (IInstruction | TransactionInstruction)[],
  feePayer: Address | PublicKey,
  lookupTableAddresses?: (Address | PublicKey)[],
  rpcUrl?: string,
  isTriton?: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<TransactionMessage> => {
  return buildTransaction(
    normalizeInstructions(instructions),
    createFeePayerSigner(feePayer),
    getPriorityConfig(transactionConfig),
    getConnectionContext(rpcUrl, isTriton),
    normalizeAddresses(lookupTableAddresses)
  );
};

export const buildAndSendTransaction = async (
  instructions: (IInstruction | TransactionInstruction)[],
  signer: KeyPairSigner,
  lookupTableAddresses?: (Address | PublicKey)[],
  rpcUrl?: string,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
) => {
  const connectionCtx = getConnectionContext(rpcUrl);
  const transactionSettings = getPriorityConfig(transactionConfig);

  const tx = await buildTransaction(
    normalizeInstructions(instructions),
    signer,
    transactionSettings,
    connectionCtx,
    normalizeAddresses(lookupTableAddresses)
  );

  assertIsTransactionMessageWithBlockhashLifetime(tx);

  const withSigners = addSignersToTransactionMessage([signer], tx);
  const signed = await signTransactionMessageWithSigners(withSigners);

  assertTransactionIsFullySigned(signed);

  const rpc = connection(connectionCtx.rpcUrl);
  const encodedTransaction = getBase64EncodedWireTransaction(signed);

  return rpc.sendTransaction(encodedTransaction).send();
};
