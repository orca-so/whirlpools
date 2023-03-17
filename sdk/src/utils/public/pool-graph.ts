import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { AccountFetcher } from "../..";
import { AdjacencyPoolGraph } from "../graphs/adjacency-pool-graph";
import { convertListToMap } from "../txn-utils";

/**
 * An object containing the token pairs of a Whirlpool.
 * @category PoolGraph
 */
export interface PoolTokenPair {
  address: Address;
  tokenMintA: Address;
  tokenMintB: Address;
}

/**
 * Route search results for a series of graph search queries between two tokens.
 * The search id for each entry can be obtained from {@link PoolGraphUtils.getSearchRouteId}
 * If routes exist for that search id exists, it will be an array of routes.
 * If routes do not exist, it will be an empty array.
 *
 * @category PoolGraph
 */
export type RouteSearchEntires = (readonly [string, Route[]])[];

/**
 * A route to trade from start token mint to end token mint.
 *
 * @category PoolGraph
 * @param startMint - The token the route starts with
 * @param endMint - The token the route ends with
 * @param edges - An ordered list of pool addresses that make up the route
 */
export type Route = {
  startTokenMint: string;
  endTokenMint: string;
  hops: Hop[];
};

/**
 * A type representing a pool graph edge.
 *
 * @category PoolGraph
 */
export type Hop = {
  poolAddress: Address;
}

/**
 * Options for finding a route between two tokens
 *
 * @category PoolGraph
 * @param intermediateTokens - A list of tokens that can be used as intermediate hops
 */
export type RouteFindOptions = {
  intermediateTokens: Address[];
};

/**
 * A type representing a graph of pools that can be used to find routes between two tokens.
 * @category PoolGraph
 */
export type PoolGraph = {
  /**
   * Get a list of routes between two tokens for this pool graph.
   * @param startMint The token the route starts from
   * @param endMint The token the route ends in
   * @param options Options for finding a route
   * @returns A list of routes between the two tokens. If no routes are found, it will be an empty array.
   */
  getRoute: (startMint: Address, endMint: Address, options?: RouteFindOptions) => Route[];

  /**
   * Get a map of routes from a list of token pairs for this pool graph.
   * @param searchTokenPairs A list of token pairs to find routes for. The first token in the pair is the start token, and the second token is the end token.
   * @param options Options for finding a route
   * @return An array of search result entires in the same order as the searchTokenPairs.
   */
  getAllRoutes(searchTokenPairs: [Address, Address][], options?: RouteFindOptions): RouteSearchEntires;
};

/**
 * A builder class for creating a {@link PoolGraph}
 *
 * Note: we use an adjacency list as a representation of our pool graph,
 * since we assume that most token pairings don't exist as pools
 * @category PoolGraph
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
   * @param poolTokenPairs - a list of {@link PoolTokenPair} to generate this pool graph
   * @returns A {@link PoolGraph} with the provided pools
   */
  static buildPoolGraph(poolTokenPairs: PoolTokenPair[]): PoolGraph {
    return new AdjacencyPoolGraph(poolTokenPairs);
  }
}

/**
 * A utility class for working with pool graphs
 * @category PoolGraph
 */
export class PoolGraphUtils {
  static readonly ROUTE_ID_DELIMINTER = "-";

  /**
   * Get a search route id from two tokens. The id can be used to identify a route between the two tokens in {@link RouteSearchEntires}.
   * @param tokenA The first token in the route
   * @param tokenB The second token in the route
   * @returns A route id that can be used to identify a route between the two tokens in {@link RouteSearchEntires}.
   */
  static getSearchRouteId(tokenA: Address, tokenB: Address): string {
    return `${AddressUtil.toString(tokenA)}${PoolGraphUtils.ROUTE_ID_DELIMINTER}${AddressUtil.toString(tokenB)}`;
  }

  /**
   * Deconstruct a route id into the two tokens it represents
   * @param routeId - The route id to deconstruct
   * @returns A tuple of the two tokens in the route id. Returns undefined if the provided routeId is invalid.
   */
  static deconstructRouteId(routeId: string): [string, string] {
    const split = routeId.split(PoolGraphUtils.ROUTE_ID_DELIMINTER);

    if (split.length !== 2) {
      throw new Error(`Invalid route id: ${routeId}`)
    }

    const [tokenA, tokenB] = split;
    return [tokenA, tokenB];
  }
}
