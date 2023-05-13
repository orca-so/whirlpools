import { Address } from "@coral-xyz/anchor";
import { AddressUtil } from "@orca-so/common-sdk";
import _ from "lodash";
import "lodash.combinations";
import {
  Edge,
  Path,
  PathSearchEntries,
  PathSearchOptions,
  PoolGraph,
  PoolTokenPair,
} from "./public/pool-graph";
import { PoolGraphUtils } from "./public/pool-graph-utils";

/**
 * A pool graph implementation using an adjacency list.
 *
 * Whirlpools (Pools (edges) & Tokens (nodes)) are sparse graphs concentrated on popular pairs such as SOL, USDC etc.
 * Therefore this implementation is more efficient in memory consumption & building than a matrix.
 *
 * TODO: This implementation does not support 2-edge paths between identical tokens.
 */
export class AdjacencyListPoolGraph implements PoolGraph {
  readonly graph: Readonly<AdjacencyPoolGraphMap>;
  readonly tokens: Readonly<Address[]>;

  constructor(pools: PoolTokenPair[]) {
    const [adjacencyListGraphMap, insertedTokens] = buildPoolGraph(pools);
    this.graph = adjacencyListGraphMap;
    this.tokens = Array.from(insertedTokens);
  }

  getPath(startMint: Address, endMint: Address, options?: PathSearchOptions): Path[] {
    const results = this.getPathsForPairs([[startMint, endMint]], options);
    return results[0][1];
  }

  getPathsForPairs(
    searchTokenPairs: [Address, Address][],
    options?: PathSearchOptions
  ): PathSearchEntries {
    const searchTokenPairsInString = searchTokenPairs.map(([startMint, endMint]) => {
      return [AddressUtil.toString(startMint), AddressUtil.toString(endMint)] as const;
    });

    const searchTokenPairsToFind = searchTokenPairsInString.filter(([startMint, endMint]) => {
      return startMint !== endMint;
    });

    const walkMap = findWalks(
      searchTokenPairsToFind,
      this.graph,
      options?.intermediateTokens.map((token) => AddressUtil.toString(token))
    );

    const results = searchTokenPairsInString.map(([startMint, endMint]) => {
      const searchRouteId = PoolGraphUtils.getSearchPathId(startMint, endMint);

      const [internalStartMint, internalEndMint] = [startMint, endMint].sort();
      const internalRouteId = getInternalRouteId(internalStartMint, internalEndMint, false);
      const reversed = internalStartMint !== startMint;
      const pathsForSearchPair = walkMap[internalRouteId];

      const paths = pathsForSearchPair
        ? pathsForSearchPair.map<Path>((path) => {
            return {
              startTokenMint: startMint,
              endTokenMint: endMint,
              edges: getHopsFromRoute(path, reversed),
            };
          })
        : [];

      return [searchRouteId, paths] as const;
    });
    return results;
  }

  getAllPaths(options?: PathSearchOptions | undefined): PathSearchEntries {
    const tokenPairCombinations = _.combinations(this.tokens, 2) as [string, string][];
    const searchTokenPairsInString = tokenPairCombinations.map(([startMint, endMint]) => {
      return [startMint, endMint] as const;
    });

    const searchTokenPairsToFind = searchTokenPairsInString.filter(([startMint, endMint]) => {
      return startMint !== endMint;
    });

    const walkMap = findWalks(
      searchTokenPairsToFind,
      this.graph,
      options?.intermediateTokens.map((token) => AddressUtil.toString(token))
    );

    // TODO: The token pairs are is in 1 direction only, we have to reverse them to get the other direction.
    // this is actually pretty slow.consider removing reversal optimization in findWalks
    const results = searchTokenPairsInString.reduce<PathSearchEntries>(
      (acc, [startMint, endMint]) => {
        const searchRouteId = PoolGraphUtils.getSearchPathId(startMint, endMint);

        // We do not support routes that routes between identical tokens
        if (startMint === endMint) {
          acc.push([searchRouteId, []]);
          return acc;
        }

        const [internalStartMint, internalEndMint] = [startMint, endMint].sort();
        const internalRouteId = getInternalRouteId(internalStartMint, internalEndMint, false);
        const reversed = internalStartMint !== startMint;
        const pathsForSearchPair = walkMap[internalRouteId];

        const paths = pathsForSearchPair
          ? pathsForSearchPair.map<Path>((path) => {
              return {
                startTokenMint: startMint,
                endTokenMint: endMint,
                edges: getHopsFromRoute(path, reversed),
              };
            })
          : [];

        acc.push([searchRouteId, paths]);

        const reversedSearchRouteId = PoolGraphUtils.getSearchPathId(endMint, startMint);
        const reversedPaths = pathsForSearchPair
          ? pathsForSearchPair.map<Path>((path) => {
              return {
                startTokenMint: endMint,
                endTokenMint: startMint,
                edges: getHopsFromRoute(path, !reversed),
              };
            })
          : [];

        acc.push([reversedSearchRouteId, reversedPaths]);
        return acc;
      },
      []
    );

    return results;
  }
}

function getHopsFromRoute(path: string[], reversed: boolean): Edge[] {
  const finalRoutes = reversed ? path.slice().reverse() : path;

  return finalRoutes.map((hopStr) => {
    return { poolAddress: hopStr };
  });
}

type AdjacencyPoolGraphMap = Record<string, readonly PoolGraphEdge[]>;

type PoolGraphEdge = {
  address: string;
  otherToken: string;
};

// A record of path-id (tokenA-tokenB) to a list of edges
type PoolWalks = Record<string, string[][]>;

function buildPoolGraph(
  pools: PoolTokenPair[]
): readonly [Readonly<AdjacencyPoolGraphMap>, Set<string>] {
  const insertedPoolCache: Record<string, Set<string>> = {};
  const insertedTokens = new Set<string>();
  const poolGraphSet = pools.reduce((poolGraph: Record<string, PoolGraphEdge[]>, pool) => {
    const { address, tokenMintA, tokenMintB } = pool;
    const [addr, mintA, mintB] = AddressUtil.toStrings([address, tokenMintA, tokenMintB]);

    insertedTokens.add(mintA);
    insertedTokens.add(mintB);

    if (poolGraph[mintA] === undefined) {
      poolGraph[mintA] = [];
      insertedPoolCache[mintA] = new Set<string>();
    }

    if (poolGraph[mintB] === undefined) {
      poolGraph[mintB] = [];
      insertedPoolCache[mintB] = new Set<string>();
    }

    const [insertedPoolsForA, insertedPoolsForB] = [
      insertedPoolCache[mintA],
      insertedPoolCache[mintB],
    ];

    if (!insertedPoolsForA.has(addr)) {
      poolGraph[mintA].push({ address: addr, otherToken: mintB });
      insertedPoolsForA.add(addr);
    }

    if (!insertedPoolsForB.has(addr)) {
      poolGraph[mintB].push({ address: addr, otherToken: mintA });
      insertedPoolsForB.add(addr);
    }

    return poolGraph;
  }, {});

  return [poolGraphSet, insertedTokens] as const;
}

// This is currently hardcoded to find walks of max length 2, generalizing to longer walks
// may mean that a adjacency matrix might have better performance
// NOTE: that this function does not support routing between the same token on hop length 2.
function findWalks(
  tokenPairs: (readonly [string, string])[],
  poolGraph: AdjacencyPoolGraphMap,
  intermediateTokens?: string[]
) {
  const walks: PoolWalks = {};

  tokenPairs.forEach(([tokenMintFrom, tokenMintTo]) => {
    let paths = [];

    // Adjust walk's from & to token based of of internal path id.
    const [internalTokenMintFrom, internalTokenMintTo] = [tokenMintFrom, tokenMintTo].sort();
    const internalPathId = getInternalRouteId(internalTokenMintFrom, internalTokenMintTo, false);

    const poolsForTokenFrom = poolGraph[internalTokenMintFrom] || [];
    const poolsForTokenTo = poolGraph[internalTokenMintTo] || [];

    // If the internal path id has already been created, then there is no need to re-search the path.
    // Possible that the path was searched in reverse.
    if (!!walks[internalPathId]) {
      return;
    }

    // Find all direct pool paths, i.e. all edges shared between tokenA and tokenB
    const singleHop = poolsForTokenFrom
      .filter(({ address }) => poolsForTokenTo.some((p) => p.address === address))
      .map((op) => [op.address]);
    paths.push(...singleHop);

    // Remove all direct edges from poolA to poolB
    const firstHop = poolsForTokenFrom.filter(
      ({ address }) => !poolsForTokenTo.some((p) => p.address === address)
    );

    // Find all edges/nodes from neighbors of A that connect to B to create paths of length 2
    // tokenA --> tokenX --> tokenB
    firstHop.forEach((firstPool) => {
      const intermediateToken = firstPool.otherToken;
      if (!intermediateTokens || intermediateTokens.indexOf(intermediateToken) > -1) {
        const secondHops = poolsForTokenTo
          .filter((secondPool) => secondPool.otherToken === intermediateToken)
          .map((secondPool) => [firstPool.address, secondPool.address]);
        paths.push(...secondHops);
      }
    });

    if (paths.length > 0) {
      walks[internalPathId] = paths;
    }
  });

  return walks;
}

function getInternalRouteId(tokenA: Address, tokenB: Address, sort = true): string {
  const mints = [AddressUtil.toString(tokenA), AddressUtil.toString(tokenB)];
  const sortedMints = sort ? mints.sort() : mints;
  return `${sortedMints[0]}${PoolGraphUtils.PATH_ID_DELIMITER}${sortedMints[1]}`;
}
