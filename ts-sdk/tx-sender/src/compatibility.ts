import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import {
  AccountRole,
  Address,
  createDefaultRpcTransport,
  Rpc,
  SolanaRpcApi,
  IInstruction,
  SignatureDictionary,
  Transaction,
  TransactionPartialSignerConfig,
} from "@solana/web3.js";
import { fromLegacyPublicKey } from "@solana/compat";
import { PublicKey } from "@solana/web3.js/src/publickey";
import { Keypair } from "@solana/web3.js/src/keypair";
import { TransactionInstruction } from "@solana/web3.js/src/transaction";

function rpcFromUrl(url: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi({
    defaultCommitment: "confirmed",
  });
  const transport = createDefaultRpcTransport({ url });
  const rpc = createRpc({ api, transport });
  return rpc;
}

function fromLegacyTransactionInstruction(
  legacyInstruction: TransactionInstruction
): IInstruction {
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
}

function determineRole(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

function forceAddress(address: Address | PublicKey) {
  if (address instanceof PublicKey) {
    return fromLegacyPublicKey(address);
  }
  return address;
}

function normalizeAddresses(addresses?: (PublicKey | Address)[]) {
  return addresses?.map((addr) => forceAddress(addr)) ?? [];
}

function normalizeInstructions(
  instructions?: (IInstruction | TransactionInstruction)[]
) {
  return (
    instructions?.map((i) =>
      i instanceof TransactionInstruction
        ? fromLegacyTransactionInstruction(i)
        : i
    ) ?? []
  );
}

// To build transaction we need a Signer object but we dont actually need to sign anything
function createFeePayerSigner(feePayer: PublicKey | Address): {
  address: Address;
  signTransactions(
    transactions: readonly Transaction[],
    config?: TransactionPartialSignerConfig
  ): Promise<readonly SignatureDictionary[]>;
} {
  return {
    address: forceAddress(feePayer),
    signTransactions: async () => {
      return Promise.all([]);
    },
  };
}

export {
  TransactionInstruction,
  PublicKey,
  Keypair,
  createFeePayerSigner,
  normalizeInstructions,
  normalizeAddresses,
  rpcFromUrl,
  forceAddress,
};
