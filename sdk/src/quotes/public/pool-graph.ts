import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";

export interface TokenPairPool {
  address: Address;
  tokenMintA: Address;
  tokenMintB: Address;
}

export type PoolGraphEdge = {
  address: string;
  otherToken: string;
};

export type PoolGraph = Record<string, Array<PoolGraphEdge>>;
export type PoolWalks = Record<string, string[][]>;

/**
 * Convenience method for finding walks between pairs of tokens, given a set of pools pairing tokens
 * @param pairs Pairs of tokens for which to find walks.
 * @param pools Pools that allow bi-directional swaps between token pairs.
 * @param intermediateTokens Allowed list of tokens that can be intermediate tokens.
 * @returns Walks between pairs of tokens
 */
export function findWalksFromPools(
  pairs: Array<[string, string]>,
  pools: TokenPairPool[],
  intermediateTokens?: string[]
) {
  const poolGraph = buildPoolGraph(pools);
  return findWalks(pairs, poolGraph, intermediateTokens);
}

/**
 * Note: we use an adjacency list as a representation of our pool graph,
 * since we assume that most token pairings don't exist as pools
 */
export function buildPoolGraph(pools: TokenPairPool[]) {
  const poolGraphSet = pools.reduce((poolGraph: Record<string, Set<PoolGraphEdge>>, pool) => {
    const { address, tokenMintA, tokenMintB } = pool;
    const [addr, mintA, mintB] = AddressUtil.toPubKeys([address, tokenMintA, tokenMintB]).map(
      (pk) => pk.toBase58()
    );

    if (poolGraph[mintA] === undefined) {
      poolGraph[mintA] = new Set();
    }

    if (poolGraph[mintB] === undefined) {
      poolGraph[mintB] = new Set();
    }

    poolGraph[mintA].add({ address: addr, otherToken: mintB });
    poolGraph[mintB].add({ address: addr, otherToken: mintA });
    return poolGraph;
  }, {});

  return Object.fromEntries(
    Object.entries(poolGraphSet).map(([mint, otherMints]) => [mint, Array.from(otherMints)])
  );
}

// This is currently hardcoded to find walks of max length 2, generalizing to longer walks
// may mean that a adjacency matrix might have better performance
export function findWalks(
  tokenPairs: Array<[string, string]>,
  poolGraph: PoolGraph,
  intermediateTokens?: string[]
) {
  const walks: PoolWalks = {};

  tokenPairs.forEach(([tokenMintA, tokenMintB]) => {
    let routes = [];

    const poolA = poolGraph[tokenMintA] || [];
    const poolB = poolGraph[tokenMintB] || [];

    // Find all direct pool routes, i.e. all edges shared between tokenA and tokenB
    const singleHop = poolA
      .filter(({ address }) => poolB.some((p) => p.address === address))
      .map((op) => [op.address]);
    routes.push(...singleHop);

    // Remove all direct edges from poolA to poolB
    const firstHop = poolA.filter(({ address }) => !poolB.some((p) => p.address === address));

    // Find all edges/nodes from neighbors of A that connect to B to create routes of length 2
    // tokenA --> tokenX --> tokenB
    firstHop.forEach((firstPool) => {
      const intermediateToken = firstPool.otherToken;
      if (!intermediateTokens || intermediateTokens.indexOf(intermediateToken) > -1) {
        const secondHops = poolB
          .filter((secondPool) => secondPool.otherToken === intermediateToken)
          .map((secondPool) => [firstPool.address, secondPool.address]);
        routes.push(...secondHops);
      }
    });

    if (routes.length > 0) {
      walks[getRouteId(tokenMintA, tokenMintB)] = routes;
    }
  });

  return walks;
}

/**
 * Returns a route id for a swap between source & destination mint for the Orca UI.
 *
 * The route ID is the key in the TradeRoutes data structure, mapping to a
 * collection of routes that can trade between the two tokens.
 *
 * @param sourceMint - The token the swap is trading from.
 * @param destinationMint - The token the swap is trading for.
 * @returns A string representing the routeId between the two provided tokens.
 */
export function getRouteId(sourceMint: string, destinationMint: string) {
  const [mintA, mintB] = stringSortMintKeys(sourceMint, destinationMint);
  return `${mintA}/${mintB}`;
}

// Not the right way to sort public-keys, but this doesn't matter when we generate route-ids.
function stringSortMintKeys(mintA: string, mintB: string) {
  return [mintA, mintB].sort();
}
