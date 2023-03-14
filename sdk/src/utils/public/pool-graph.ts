import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { AccountFetcher } from "../..";
import { AdjacencyPoolGraph } from "../graphs/adjacency-pool-graph";
import { convertListToMap } from "../txn-utils";
import { PoolTokenPair } from "./types";

/**
 * A map of route ids to a list of routes between the two tokens
 * The route id can be obtained from {@link PoolGraphUtils.getRouteId}
 */
export type RouteMap = Record<string, Route[]>;

/**
 * A route between two tokens
 * @param startMint - The token the route starts with
 * @param endMint - The token the route ends with
 * @param edges - An ordered list of pool addresses that make up the route
 */
export type Route = {
  startMint: string;
  endMint: string;
  edges: string[];
};

/**
 * Options for finding a route between two tokens
 * @param intermediateTokens - A list of tokens that can be used as intermediate hops
 */
export type RouteFindOptions = {
  intermediateTokens: Address[];
};

/**
 * A type representing a graph of pools that can be used to find routes between two tokens.
 */
export type PoolGraph = {
  /**
   * Get a list of routes between two tokens for this pool graph.
   * @param startMint The token the route starts with
   * @param endMint The token the route ends with
   * @param options Options for finding a route
   * @returns A list of routes between the two tokens
   */
  getRoute: (startMint: Address, endMint: Address, options?: RouteFindOptions) => Route[];

  /**
   * Get a map of routes from a list of token pairs for this pool graph.
   * @param tokens A list of token pairs to find routes for. The first token in the pair is the start token, and the second token is the end token.
   * @param options Options for finding a route
   * @return A map of routes from a list of token pairs
   */
  getAllRoutes(tokens: [Address, Address][], options?: RouteFindOptions): RouteMap;
};

/**
 * Note: we use an adjacency list as a representation of our pool graph,
 * since we assume that most token pairings don't exist as pools
 */
/**
 * A builder class for creating a {@link PoolGraph}
 */
export class PoolGraphBuilder {

  /**
   * Fetch data and build a {@link PoolGraph} from a list of pools addresses
   * @param pools - a list of pool addresses to generate this pool graph
   * @param fetcher - {@link AccountFetcher} to use for fetching pool data
   * @returns A {@link PoolGraph} with the provided pools
   */
  static async buildPoolGraphWithFetch(
    pools: Address[],
    fetcher: AccountFetcher
  ): Promise<PoolGraph> {
    const poolAccounts = convertListToMap(
      await fetcher.listPools(pools, false),
      pools.map((pool) => AddressUtil.toPubKey(pool).toBase58())
    );
    const poolTokenPairs = Object.entries(poolAccounts)
      .map(([addr, pool]) => {
        if (pool) {
          return {
            address: addr,
            tokenMintA: pool.tokenMintA,
            tokenMintB: pool.tokenMintB,
          };
        }
        return null;
      })
      .flatMap((pool) => (pool ? pool : []));

    return new AdjacencyPoolGraph(poolTokenPairs);
  }

  /**
   * Build a {@link PoolGraph} from a list of pools in the format of {@link PoolTokenPair}
   * @param pools - a list of {@link PoolTokenPair} to generate this pool graph
   * @returns A {@link PoolGraph} with the provided pools
   */
  static buildPoolGraph(pools: PoolTokenPair[]): PoolGraph {
    return new AdjacencyPoolGraph(pools);
  }
}

export class PoolGraphUtils {
  /**
   * Returns a route id for a swap between source & destination mint for the Orca UI.
   * The route id is a string of the two mints in alphabetical order, separated by a dash.
   *
   * @param sourceMint - The token the swap is trading from.
   * @param destinationMint - The token the swap is trading for.
   * @returns A string representing the routeId between the two provided tokens.
   */
  static getRouteId(tokenA: Address, tokenB: Address): string {
    const mints = [AddressUtil.toString(tokenA), AddressUtil.toString(tokenB)];
    const sortedMints = mints.sort();
    return `${sortedMints[0]}-${sortedMints[1]}`;
  }

  /**
   * Deconstruct a route id into the two tokens it represents
   * @param routeId - The route id to deconstruct
   * @returns A tuple of the two tokens in the route id. Returns undefined if the provided routeId is invalid.
   */
  static deconstructRouteId(routeId: string): [string, string] | undefined {
    const split = routeId.split("-");

    if (split.length !== 2) {
      console.error("Invalid routeId");
      return undefined;
    }

    const [tokenA, tokenB] = split;
    return [tokenA, tokenB];
  }
}
