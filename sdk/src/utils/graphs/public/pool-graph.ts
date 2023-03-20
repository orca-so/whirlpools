import { Address } from "@project-serum/anchor";

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
export type RouteSearchEntries = (readonly [string, Route[]])[];

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
};

/**
 * Options for finding a route between two tokens
 *
 * @category PoolGraph
 * @param intermediateTokens - A list of tokens that can be used as intermediate hops
 */
export type RouteSearchOptions = {
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
  getRoute: (startMint: Address, endMint: Address, options?: RouteSearchOptions) => Route[];

  /**
   * Get a map of routes from a list of token pairs for this pool graph.
   * @param searchTokenPairs A list of token pairs to find routes for. The first token in the pair is the start token, and the second token is the end token.
   * @param options Options for finding a route
   * @return An array of search result entires in the same order as the searchTokenPairs.
   */
  getRoutesForPairs(
    searchTokenPairs: [Address, Address][],
    options?: RouteSearchOptions
  ): RouteSearchEntries;
};
