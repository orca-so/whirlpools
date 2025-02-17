import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import {
  Address,
  createDefaultRpcTransport,
  Rpc,
  SolanaRpcApi,
  address,
} from "@solana/web3.js";

export function rpcFromUrl(url: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi({
    defaultCommitment: "confirmed",
  });
  const transport = createDefaultRpcTransport({ url });
  const rpc = createRpc({ api, transport });
  return rpc;
}

export function normalizeAddresses(
  addresses?: (string | Address)[]
): Address[] {
  return addresses?.map((addr) => address(addr)) ?? [];
}
