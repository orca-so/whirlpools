import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import {
  Address,
  createDefaultRpcTransport,
  Rpc,
  SolanaRpcApi,
  SignatureDictionary,
  Transaction,
  TransactionPartialSignerConfig,
  address,
} from "@solana/web3.js";

function rpcFromUrl(url: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi({
    defaultCommitment: "confirmed",
  });
  const transport = createDefaultRpcTransport({ url });
  const rpc = createRpc({ api, transport });
  return rpc;
}

function normalizeAddresses(addresses?: (string | Address)[]): Address[] {
  return addresses?.map((addr) => address(addr)) ?? [];
}

// To build transaction we need a Signer object but we dont actually need to sign anything
function createFeePayerSigner(feePayer: string | Address): {
  address: Address;
  signTransactions(
    transactions: readonly Transaction[],
    config?: TransactionPartialSignerConfig
  ): Promise<readonly SignatureDictionary[]>;
} {
  return {
    address: address(feePayer),
    signTransactions: async () => {
      return Promise.all([]);
    },
  };
}

export { createFeePayerSigner, normalizeAddresses, rpcFromUrl };
