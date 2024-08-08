import type { Address } from "@coral-xyz/anchor";

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
 * Results for a series of graph search queries between two tokens.
 * The search id for each entry can be obtained from {@link PoolGraphUtils.getSearchRouteId}
 * If a path exist between tokens for that search id, it will be an array of paths.
 * If paths do not exist, it will be an empty array.
 *
 * @category PoolGraph
 */
export type PathSearchEntries = (readonly [string, Path[]])[];

/**
 * A path to trade from start token mint to end token mint.
 *
 * @category PoolGraph
 * @param startMint - The token the path starts with
 * @param endMint - The token the path ends with
 * @param edges - An ordered list of edges (pool addresses) that make up the path
 */
export type Path = {
  startTokenMint: string;
  endTokenMint: string;
  edges: Edge[];
};

/**
 * A type representing a pool graph edge.
 *
 * @category PoolGraph
 */
export type Edge = {
  poolAddress: Address;
};

/**
 * Options for finding a path between two tokens
 *
 * @category PoolGraph
 * @param intermediateTokens - A list of tokens that can be used as intermediate hops
 */
export type PathSearchOptions = {
  intermediateTokens: Address[];
};

/**
 * A type representing an undirected graph of pools that can be used to find paths between two tokens.
 * In this graph, nodes are token mints, and edges are pools
 *
 * @category PoolGraph
 */
export type PoolGraph = {
  /**
   * Get a list of paths between two tokens for this pool graph.
   *
   * Notes:
   * - Only support paths with up to 2 edges
   * - Paths searching between two identical token mints are not supported.
   *
   * @param startMint The token the path starts from
   * @param endMint The token the path ends in
   * @param options Options for finding a path
   * @returns A list of path between the two tokens. If no path are found, it will be an empty array.
   */
  getPath: (
    startMint: Address,
    endMint: Address,
    options?: PathSearchOptions,
  ) => Path[];

  /**
   * Get a map of paths from a list of token pairs for this pool graph.
   *
   * Notes:
   * - Only support paths with up to 2 edges
   * - Paths searching between two identical token mints are not supported.
   *
   * @param searchTokenPairs A list of token pairs to find paths for. The first token in the pair is the start token, and the second token is the end token.
   * @param options Options for finding a path
   * @return An array of search result entires in the same order as the searchTokenPairs.
   */
  getPathsForPairs(
    searchTokenPairs: [Address, Address][],
    options?: PathSearchOptions,
  ): PathSearchEntries;

  /**
   * Get a list of all paths for this pool graph.
   * @param options Options for finding a path
   * @return An array of all permutations of token-pairs to the paths for each pair.
   */
  getAllPaths(options?: PathSearchOptions): PathSearchEntries;
};
