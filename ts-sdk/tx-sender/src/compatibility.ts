import { createSolanaRpcApi, createRpc } from "@solana/rpc";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { createDefaultRpcTransport, address } from "@solana/kit";

/**
 * Creates an RPC client instance for interacting with the SVM blockchains using the provided RPC URL.
 *
 * @param {string} url - The RPC endpoint URL.
 * @returns {Rpc<SolanaRpcApi>} An RPC client configured with the Solana RPC API.
 *
 * @example
 * ```ts
 * const rpc = rpcFromUrl("https://api.mainnet-beta.solana.com");
 * const slot = await rpc.getSlot().send();
 * console.log(slot);
 * ```
 */
export function rpcFromUrl(url: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi({
    defaultCommitment: "confirmed",
  });
  const transport = createDefaultRpcTransport({ url });
  const rpc = createRpc({ api, transport });
  return rpc;
}

export function normalizeAddresses(
  addresses?: (string | Address)[],
): Address[] {
  return addresses?.map((addr) => address(addr)) ?? [];
}
