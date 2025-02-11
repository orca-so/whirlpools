import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import {
  Address,
  createDefaultRpcTransport,
  Rpc,
  SolanaRpcApi,
  address,
  createSolanaRpcSubscriptions,
} from "@solana/web3.js";

function rpcFromUrl(url: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi({
    defaultCommitment: "confirmed",
  });
  const transport = createDefaultRpcTransport({ url });
  const rpc = createRpc({ api, transport });
  return rpc;
}

function subscriptionsFromWsUrl(wsUrl: string) {
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  return rpcSubscriptions;
}

function normalizeAddresses(addresses?: (string | Address)[]): Address[] {
  return addresses?.map((addr) => address(addr)) ?? [];
}

export { normalizeAddresses, rpcFromUrl, subscriptionsFromWsUrl };
