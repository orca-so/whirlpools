import { IInstruction } from "@solana/instructions";
import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import {
  Address,
  appendTransactionMessageInstructions,
  Blockhash,
  createDefaultRpcTransport,
  createTransactionMessage,
  getComputeUnitEstimateForTransactionMessageFactory,
  isWritableRole,
  pipe,
  Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/web3.js";
import { fromLegacyPublicKey } from "@solana/compat";
import { PublicKey } from "./types";

export const forceAddress = (address: Address | PublicKey) => {
  if (address instanceof PublicKey) {
    return fromLegacyPublicKey(address);
  }
  return address;
};

export const generateTransactionMessage = (
  instructions: IInstruction[],
  blockhash: {
    blockhash: Blockhash;
    lastValidBlockHeight: bigint;
  },
  signer: TransactionSigner
) => {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );
};

export const connection = (url: string): Rpc<SolanaRpcApi> => {
  const api = createSolanaRpcApi({
    defaultCommitment: "confirmed",
  });
  const transport = createDefaultRpcTransport({ url });
  const rpc = createRpc({ api, transport });
  return rpc;
};

export const getComputeUnitsForInstructions = async (
  rpc: Rpc<SolanaRpcApi>,
  instructions: IInstruction[],
  signer: TransactionSigner
): Promise<number> => {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = generateTransactionMessage(instructions, blockhash, signer);
  const estimator = getComputeUnitEstimateForTransactionMessageFactory({
    rpc,
  });
  const estimate = await estimator(message);
  return estimate;
};

export const getWritableAccounts = (ixs: IInstruction[]) => {
  const writable = new Set<Address>();
  ixs.forEach((ix) => {
    if (ix.accounts) {
      ix.accounts.forEach((acc) => {
        if (isWritableRole(acc.role)) writable.add(acc.address);
      });
    }
  });
  return Array.from(writable);
};
