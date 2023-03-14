import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { AccountFetcher } from "../..";
import { AdjacencyPoolGraph } from "../graphs/adjacency-pool-graph";
import { convertListToMap } from "../txn-utils";
import { PoolTokenPair } from "./types";

// A record of id (tokenA-tokenB) to a list of paths between the two tokens
export type RoutePathMap = Record<string, RoutePath[]>;

// A route between two tokens
export type RoutePath = {
  startMint: string,
  endMint: string,
  edges: string[]
}

// TODO: Add max-hop here. For now it's hardcoded to 2.
export type RouteFindOptions = {
  intermediateTokens: Address[];
}

export type RouteEdge = {
  tokenA: Address;
  tokenB: Address;
}

export type PoolGraph = {
  getRoute: (startMint: Address, endMint: Address, options?: RouteFindOptions) => RoutePath[];
  getAllRoutes(tokens: [Address, Address][], options?: RouteFindOptions): RoutePathMap;
}

/**
 * Note: we use an adjacency list as a representation of our pool graph,
 * since we assume that most token pairings don't exist as pools
 */
export class PoolGraphBuilder {
  static async buildPoolGraphWithFetch(pools: Address[], fetcher: AccountFetcher): Promise<PoolGraph> {
    // Fetch pools and convert to PoolTokenPair
    const poolAccounts = convertListToMap(await fetcher.listPools(pools, false), pools.map(pool => AddressUtil.toPubKey(pool).toBase58()));
    const poolTokenPairs = Object.entries(poolAccounts).map(([addr, pool]) => {
      if (pool) {
        return {
          address: addr,
          tokenMintA: pool.tokenMintA,
          tokenMintB: pool.tokenMintB,
        }
      }
      return null;
    }).flatMap(pool => pool ? pool : []);

    return new AdjacencyPoolGraph(poolTokenPairs)
  }

  static buildPoolGraph(pools: PoolTokenPair[]): PoolGraph {
    return new AdjacencyPoolGraph(pools)
  }
}


