import type {
  BlockhashWithExpiryBlockHeight,
  Signer,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * @category Transactions Util
 */
export const EMPTY_INSTRUCTION: Instruction = {
  instructions: [],
  cleanupInstructions: [],
  signers: [],
};

/**
 * @category Transactions Util
 */
export type Instruction = {
  instructions: TransactionInstruction[];
  cleanupInstructions: TransactionInstruction[];
  signers: Signer[];
};

/**
 * @category Transactions Util
 */
export type TransactionPayload = {
  transaction: Transaction | VersionedTransaction;
  signers: Signer[];
  recentBlockhash: BlockhashWithExpiryBlockHeight;
};

/**
 * @category Transactions Util
 * @deprecated
 */
export type SendTxRequest = {
  transaction: Transaction | VersionedTransaction;
  signers?: Signer[];
};
