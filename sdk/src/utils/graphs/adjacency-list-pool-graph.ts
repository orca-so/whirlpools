import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  Hop,
  PoolGraph,
  PoolTokenPair,
  Route,
  RouteSearchEntries,
  RouteSearchOptions
} from "./public/pool-graph";
import { PoolGraphUtils } from "./public/pool-graph-utils";

/**
 * A pool graph implementation using an adjacency list.
 *
 * Whirlpools (Pools (edges) & Tokens (nodes)) are sparse graphs concentrated on popular pairs such as SOL, USDC etc.
 * Therefore this implementation is more efficient in memory consumption & building than a matrix.
 */
export class AdjacencyListPoolGraph implements PoolGraph {
  readonly graph: Record<string, PoolGraphEdge[]>;
  readonly cache: Record<string, Route[]> = {};

  constructor(pools: PoolTokenPair[]) {
    this.graph = buildPoolGraph(pools);
  }

  getRoute(startMint: Address, endMint: Address, options?: RouteSearchOptions): Route[] {
    const results = this.getRoutesForPairs([[startMint, endMint]], options);
    return results[0][1];
  }

  getRoutesForPairs(
    searchTokenPairs: [Address, Address][],
    options?: RouteSearchOptions
  ): RouteSearchEntries {
    // Filter out the pairs that has cached values
    const searchTokenPairsToFind = searchTokenPairs.filter(([startMint, endMint]) => {
      return !this.cache[PoolGraphUtils.getSearchRouteId(startMint, endMint)];
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
      const searchRouteId = PoolGraphUtils.getSearchRouteId(startMint, endMint);

      let cacheValue = this.cache[searchRouteId];
      if (!!cacheValue) {
        return [searchRouteId, cacheValue] as const;
      }

      // If we don't have a cached value, we should have a walkMap entry
      const internalRouteId = getInternalRouteId(startMint, endMint);
      const routesForSearchPair = walkMap[internalRouteId];

      const paths = routesForSearchPair ?
        routesForSearchPair.map<Route>((route) => {
          return {
            startTokenMint: AddressUtil.toString(startMint),
            endTokenMint: AddressUtil.toString(endMint),
            hops: getHopsFromRoute(internalRouteId, searchRouteId, route),
          };
        }) : [];

      // save to cache
      this.cache[searchRouteId] = paths;

      return [searchRouteId, paths] as const;
    });

    return results;
  }
}

function getHopsFromRoute(internalRouteId: string, searchRouteId: string, route: string[]): Hop[] {
  const [intStartA] = PoolGraphUtils.deconstructRouteId(internalRouteId);
  const [searchStartA] = PoolGraphUtils.deconstructRouteId(searchRouteId);
  const shouldReverseRoute = searchStartA !== intStartA;
  const finalRoutes = shouldReverseRoute ? route.reverse() : route;

  return finalRoutes.map((hopStr) => {
    return { poolAddress: new PublicKey(hopStr) };
  });
}

type AdjacencyPoolGraphMap = Record<string, Array<PoolGraphEdge>>;

type PoolGraphEdge = {
  address: string;
  otherToken: string;
};

// A record of route-id (tokenA-tokenB) to a list of edges
type PoolWalks = Record<string, string[][]>;

function buildPoolGraph(pools: PoolTokenPair[]) {
  const poolGraphSet = pools.reduce((poolGraph: Record<string, PoolGraphEdge[]>, pool) => {
    const { address, tokenMintA, tokenMintB } = pool;
    const [addr, mintA, mintB] = AddressUtil.toStrings([address, tokenMintA, tokenMintB]);

    if (poolGraph[mintA] === undefined) {
      poolGraph[mintA] = [];
    }

    if (poolGraph[mintB] === undefined) {
      poolGraph[mintB] = [];
    }

    const existingAddressesForA = poolGraph[mintA].map((p) => p.address);
    const existingAddressesForB = poolGraph[mintB].map((p) => p.address);

    if (!existingAddressesForA.includes(addr)) {
      poolGraph[mintA].push({ address: addr, otherToken: mintB });
    }

    if (!existingAddressesForB.includes(addr)) {
      poolGraph[mintB].push({ address: addr, otherToken: mintA });
    }

    return poolGraph;
  }, {});

  return Object.fromEntries(
    Object.entries(poolGraphSet).map(([mint, otherMints]) => [mint, Array.from(otherMints)])
  );
}

// This is currently hardcoded to find walks of max length 2, generalizing to longer walks
// may mean that a adjacency matrix might have better performance
function findWalks(
  tokenPairs: (readonly [string, string])[],
  poolGraph: AdjacencyPoolGraphMap,
  intermediateTokens?: string[]
) {
  const walks: PoolWalks = {};

  tokenPairs.forEach(([tokenMintFrom, tokenMintTo]) => {
    let routes = [];

    const internalRouteId = getInternalRouteId(tokenMintFrom, tokenMintTo);
    const poolsForTokenFrom = poolGraph[tokenMintFrom] || [];
    const poolsForTokenTo = poolGraph[tokenMintTo] || [];

    // If the internal route id has already been created, then there is no need to re-search the route.
    // Possible that the route was searched in reverse.
    if (!!walks[internalRouteId]) {
      return;
    }

    // Find all direct pool routes, i.e. all edges shared between tokenA and tokenB
    const singleHop = poolsForTokenFrom
      .filter(({ address }) => poolsForTokenTo.some((p) => p.address === address))
      .map((op) => [op.address]);
    routes.push(...singleHop);

    // Remove all direct edges from poolA to poolB
    const firstHop = poolsForTokenFrom.filter(
      ({ address }) => !poolsForTokenTo.some((p) => p.address === address)
    );

    // Find all edges/nodes from neighbors of A that connect to B to create routes of length 2
    // tokenA --> tokenX --> tokenB
    firstHop.forEach((firstPool) => {
      const intermediateToken = firstPool.otherToken;
      if (!intermediateTokens || intermediateTokens.indexOf(intermediateToken) > -1) {
        const secondHops = poolsForTokenTo
          .filter((secondPool) => secondPool.otherToken === intermediateToken)
          .map((secondPool) => [firstPool.address, secondPool.address]);
        routes.push(...secondHops);
      }
    });

    if (routes.length > 0) {
      const [intStartA] = PoolGraphUtils.deconstructRouteId(internalRouteId);
      const routeIdWasReversed = intStartA !== tokenMintFrom;
      const finalRoutes = routeIdWasReversed ? routes.map((route) => route.reverse()) : routes;
      walks[internalRouteId] = finalRoutes;
    }
  });

  return walks;
}

function getInternalRouteId(tokenA: Address, tokenB: Address): string {
  const mints = [AddressUtil.toString(tokenA), AddressUtil.toString(tokenB)];
  const sortedMints = mints.sort();
  return `${sortedMints[0]}${PoolGraphUtils.ROUTE_ID_DELIMITER}${sortedMints[1]} `;
}
