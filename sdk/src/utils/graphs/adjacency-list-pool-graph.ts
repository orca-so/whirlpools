import { Address } from "@coral-xyz/anchor";
import { AddressUtil } from "@orca-so/common-sdk";
import {
  Edge,
  Path,
  PathSearchEntries,
  PathSearchOptions,
  PoolGraph,
  PoolTokenPair
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

  constructor(pools: PoolTokenPair[]) {
    this.graph = buildPoolGraph(pools);
  }

  getPath(startMint: Address, endMint: Address, options?: PathSearchOptions): Path[] {
    const results = this.getPathsForPairs([[startMint, endMint]], options);
    return results[0][1];
  }

  getPathsForPairs(
    searchTokenPairs: [Address, Address][],
    options?: PathSearchOptions
  ): PathSearchEntries {
    const searchTokenPairsToFind = searchTokenPairs.filter(([startMint, endMint]) => {
      return AddressUtil.toString(startMint) !== AddressUtil.toString(endMint);
    });

    const searchTokenPairsToFindAddrs = searchTokenPairsToFind.map(([startMint, endMint]) => {
      return [AddressUtil.toString(startMint), AddressUtil.toString(endMint)] as const;
    });

    const walkMap = findWalks(
      searchTokenPairsToFindAddrs,
      this.graph,
      options?.intermediateTokens.map((token) => AddressUtil.toString(token))
    );

    const results = searchTokenPairs.map(([startMint, endMint]) => {
      const searchRouteId = PoolGraphUtils.getSearchPathId(startMint, endMint);

      const internalRouteId = getInternalRouteId(startMint, endMint);
      const pathsForSearchPair = walkMap[internalRouteId];

      const paths = pathsForSearchPair
        ? pathsForSearchPair.map<Path>((path) => {
            return {
              startTokenMint: AddressUtil.toString(startMint),
              endTokenMint: AddressUtil.toString(endMint),
              edges: getHopsFromRoute(internalRouteId, searchRouteId, path),
            };
          })
        : [];

      return [searchRouteId, paths] as const;
    });

    return results;
  }
}

function getHopsFromRoute(internalRouteId: string, searchRouteId: string, path: string[]): Edge[] {
  const [intStartA] = PoolGraphUtils.deconstructPathId(internalRouteId);
  const [searchStartA] = PoolGraphUtils.deconstructPathId(searchRouteId);
  const shouldReverseRoute = searchStartA !== intStartA;
  const finalRoutes = shouldReverseRoute ? path.slice().reverse() : path;

  return finalRoutes.map((hopStr) => {
    return { poolAddress: new PublicKey(hopStr) };
  });
}

type AdjacencyPoolGraphMap = Record<string, PoolGraphEdge[]>;

type PoolGraphEdge = {
  address: string;
  otherToken: string;
};

// A record of path-id (tokenA-tokenB) to a list of edges
type PoolWalks = Record<string, string[][]>;

function buildPoolGraph(pools: PoolTokenPair[]): Readonly<AdjacencyPoolGraphMap> {
  const insertedPoolCache: Record<string, Set<string>> = {};
  const poolGraphSet = pools.reduce((poolGraph: Record<string, PoolGraphEdge[]>, pool) => {
    const { address, tokenMintA, tokenMintB } = pool;
    const [addr, mintA, mintB] = AddressUtil.toStrings([address, tokenMintA, tokenMintB]);

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

  return poolGraphSet;
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
    const internalPathId = getInternalRouteId(tokenMintFrom, tokenMintTo);
    const [internalTokenMintFrom, internalTokenMintTo] = [tokenMintFrom, tokenMintTo].sort();

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

function getInternalRouteId(tokenA: Address, tokenB: Address): string {
  const mints = [AddressUtil.toString(tokenA), AddressUtil.toString(tokenB)];
  const sortedMints = mints.sort();
  return `${sortedMints[0]}${PoolGraphUtils.PATH_ID_DELIMITER}${sortedMints[1]} `;
}
