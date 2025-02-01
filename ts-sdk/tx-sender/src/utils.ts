import { IInstruction } from "@solana/instructions";
import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import {
  AccountRole,
  Address,
  appendTransactionMessageInstructions,
  Blockhash,
  CompilableTransactionMessage,
  createDefaultRpcTransport,
  createTransactionMessage,
  getComputeUnitEstimateForTransactionMessageFactory,
  isWritableRole,
  pipe,
  Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  SignatureDictionary,
  SolanaRpcApi,
  Transaction,
  TransactionPartialSignerConfig,
  TransactionSigner,
} from "@solana/web3.js";
import { fromLegacyPublicKey } from "@solana/compat";
import { PublicKey } from "./types";
import { TransactionInstruction } from "@solana/web3.js/src/transaction";

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

export const getComputeUnitsForTxMessage = async (
  rpc: Rpc<SolanaRpcApi>,
  txMessage: CompilableTransactionMessage
): Promise<number> => {
  const estimator = getComputeUnitEstimateForTransactionMessageFactory({
    rpc,
  });
  const estimate = await estimator(txMessage);
  return estimate;
};

export const getWritableAccounts = (ixs: readonly IInstruction[]) => {
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

export const fromLegacyTransactionInstruction = (
  legacyInstruction: TransactionInstruction
): IInstruction => {
  const data =
    legacyInstruction.data?.byteLength > 0
      ? Uint8Array.from(legacyInstruction.data)
      : undefined;
  const accounts = legacyInstruction.keys.map((accountMeta) =>
    Object.freeze({
      address: fromLegacyPublicKey(accountMeta.pubkey),
      role: determineRole(accountMeta.isSigner, accountMeta.isWritable),
    })
  );
  const programAddress = fromLegacyPublicKey(legacyInstruction.programId);
  return Object.freeze({
    ...(accounts.length ? { accounts: Object.freeze(accounts) } : null),
    ...(data ? { data } : null),
    programAddress,
  });
};

const determineRole = (isSigner: boolean, isWritable: boolean): AccountRole => {
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
};

// To build transaction we need a Signer object but we dont actually need to sign anything
export const createFeePayerSigner = (
  feePayer: PublicKey | Address
): {
  address: Address;
  signTransactions(
    transactions: readonly Transaction[],
    config?: TransactionPartialSignerConfig
  ): Promise<readonly SignatureDictionary[]>;
} => {
  const address =
    feePayer instanceof PublicKey ? fromLegacyPublicKey(feePayer) : feePayer;
  return {
    address,
    signTransactions: async () => {
      return Promise.all([]);
    },
  };
};

export const normalizeInstructions = (
  instructions?: (IInstruction | TransactionInstruction)[]
) => {
  return (
    instructions?.map((i) =>
      i instanceof TransactionInstruction
        ? fromLegacyTransactionInstruction(i)
        : i
    ) ?? []
  );
};

export const normalizeAddresses = (addresses?: (PublicKey | Address)[]) => {
  return (
    addresses?.map((addr) =>
      addr instanceof PublicKey ? fromLegacyPublicKey(addr) : addr
    ) ?? []
  );
};
