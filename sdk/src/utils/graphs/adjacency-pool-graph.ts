import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  Hop,
  PoolGraph,
  PoolGraphUtils,
  PoolTokenPair,
  Route,
  RouteFindOptions,
  RouteSearchEntires
} from "../public/pool-graph";

export class AdjacencyPoolGraph implements PoolGraph {
  readonly graph: {
    [k: string]: PoolGraphEdge[];
  };

  constructor(pools: PoolTokenPair[]) {
    this.graph = buildPoolGraph(pools);
  }

  getRoute(startMint: Address, endMint: Address, options?: RouteFindOptions): Route[] {
    const [startMintKey, endMintKey] = [
      AddressUtil.toString(startMint),
      AddressUtil.toString(endMint),
    ];

    const walkMap = findWalks(
      [[startMintKey, endMintKey]],
      this.graph,
      options?.intermediateTokens.map((token) => AddressUtil.toString(token))
    );

    const internalRouteId = getInternalRouteId(startMintKey, endMintKey);
    const searchRouteId = PoolGraphUtils.getSearchRouteId(startMint, endMint);
    const routeForSearchPair = walkMap[internalRouteId];
    if (routeForSearchPair === undefined) {
      return [];
    }

    return routeForSearchPair.map((route) => {
      return {
        startTokenMint: startMintKey,
        endTokenMint: endMintKey,
        hops: getHopsFromRoute(internalRouteId, searchRouteId, route),
      };
    });
  }

  getAllRoutes(searchTokenPairs: [Address, Address][], options?: RouteFindOptions): RouteSearchEntires {
    const searchTokenPairsAddrs = searchTokenPairs.map(([startMint, endMint]) => {
      return [AddressUtil.toString(startMint), AddressUtil.toString(endMint)] as const;
    });
    const walkMap = findWalks(
      searchTokenPairsAddrs,
      this.graph,
      options?.intermediateTokens.map((token) => AddressUtil.toString(token))
    );

    const results = searchTokenPairsAddrs.map(([startMint, endMint]) => {
      const searchRouteId = PoolGraphUtils.getSearchRouteId(startMint, endMint);
      const internalRouteId = getInternalRouteId(startMint, endMint);
      const routesForSearchPair = walkMap[internalRouteId];
      const paths = routesForSearchPair ? routesForSearchPair.map<Route>((route) => {
        return {
          startTokenMint: startMint,
          endTokenMint: endMint,
          hops: getHopsFromRoute(internalRouteId, searchRouteId, route),
        };
      }) : [];


      return [searchRouteId, paths] as const;
    });

    return results;
  }
}

function getHopsFromRoute(internalRouteId: string, searchRouteId: string, route: string[]): Hop[] {
  // Naive technique to check directionality, but we will assume internal & search route id are generated from the
  // same token pair.

  const shouldReverseRoute = internalRouteId !== searchRouteId
  const finalRoutes = !shouldReverseRoute ? route : route.reverse();
  return finalRoutes.map(hopStr => { return { poolAddress: new PublicKey(hopStr) } })
}


type AdjacencyPoolGraphMap = Record<string, Array<PoolGraphEdge>>;

type PoolGraphEdge = {
  address: string;
  otherToken: string;
};

// A record of route-id (tokenA-tokenB) to a list of edges
type PoolWalks = Record<string, string[][]>;

function buildPoolGraph(pools: PoolTokenPair[]) {
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
function findWalks(
  tokenPairs: (readonly [string, string])[],
  poolGraph: AdjacencyPoolGraphMap,
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
      walks[getInternalRouteId(tokenMintA, tokenMintB)] = routes;
    }
  });

  return walks;
}

function getInternalRouteId(tokenA: Address, tokenB: Address): string {
  const mints = [AddressUtil.toString(tokenA), AddressUtil.toString(tokenB)];
  const sortedMints = mints.sort();
  return `${sortedMints[0]}${PoolGraphUtils.ROUTE_ID_DELIMINTER}${sortedMints[1]}`;
}