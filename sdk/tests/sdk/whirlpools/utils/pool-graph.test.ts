import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import * as assert from "assert";
import { PoolGraphBuilder, PoolGraphUtils, PoolTokenPair, Route, RouteSearchEntires } from "../../../../src";
import {
  solConnectedPools,
  uniqueTokenMintsGraphData,
  uniqueTokenMintsGraphTokenUnsortedData,
  usdcConnectedPools
} from "../../../utils/graph-test-data";

const uniqueTokenPair = uniqueTokenMintsGraphData[0];
const uniqueTokenPairSorted = uniqueTokenMintsGraphData[0];
const rlbSolPool = solConnectedPools[0];
const mSolSolPool = solConnectedPools[1];
const dustSolPool = solConnectedPools[2];
const rlbUsdcPool = usdcConnectedPools[0];
const msolUsdcPool = usdcConnectedPools[1];
const dustUsdcPool = usdcConnectedPools[2];

describe.only("PoolGraph tests", () => {
  describe("getAllRoutes", () => {
    it("Route does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const results = graph.getAllRoutes([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      assert.equal(results.length, 1);
      const searchId = PoolGraphUtils.getSearchRouteId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertGetAllRoutesResult(results, [[searchId, []]]);
    });

    it("1 route exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getAllRoutes(searchTokenPairs);
      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPair]
        ]]];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 route exist - token ordering reversed", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphTokenUnsortedData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getAllRoutes(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPairSorted]
        ]]];
      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 route with 2 hops exist - verify edge ordering correct", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getAllRoutes(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool]
        ]]];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 route with 2 hops exist - verify edge ordering correct (reverse)", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [mSolSolPool.tokenMintB, rlbSolPool.tokenMintB]
      ]
      const results = graph.getAllRoutes(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [mSolSolPool, rlbSolPool]
        ]]];
      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getAllRoutes(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]]];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("duplicated token-pairs will still be executed and ordered in results", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]

      const results = graph.getAllRoutes(searchTokenPairs);
      assert.equal(results.length, 2);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]],
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[1][0], searchTokenPairs[1][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]]];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it.only("same token-pairs but with reversed order has unique search ids", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [mSolSolPool.tokenMintB, rlbSolPool.tokenMintB],
      ]

      const results = graph.getAllRoutes(searchTokenPairs);
      assert.equal(results.length, 2);

      console.log(`results: ${JSON.stringify(results, null, 2)}`)

      // TODO: Directionality of the hops is not being considered
      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]],
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[1][0], searchTokenPairs[1][1]), [
          [mSolSolPool, rlbSolPool],
          [msolUsdcPool, rlbUsdcPool],
        ]]];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("only allow 2-hop routes that go through tokens from the intermediate token list ", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB]
      ];
      const results = graph.getAllRoutes(searchTokenPairs, {
        intermediateTokens: [rlbUsdcPool.tokenMintA],
      });

      // Assert that the SOL routes are filtered out
      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbUsdcPool, msolUsdcPool]
        ]]
      ];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries);
    });

    it("multiple tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [dustSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]

      const results = graph.getAllRoutes(searchTokenPairs);

      assert.equal(results.length, 2);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]],
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[1][0], searchTokenPairs[1][1]), [
          [dustSolPool, mSolSolPool],
          [dustUsdcPool, msolUsdcPool],
        ]]];

      assertGetAllRoutesResult(results, expectedRoutesForTokenPairQueries)
    });
  });

  describe("getRoute", async () => {
    it("Route does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const result = graph.getRoute(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);
      assert.equal(result.length, 0);
    });

    it("1 route exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const result = graph.getRoute(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertGetRouteResult(
        result,
        [[uniqueTokenPair]],
        uniqueTokenPair.tokenMintA,
        uniqueTokenPair.tokenMintB
      );
    });

    it("1 route exist - token ordering reversed", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphTokenUnsortedData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getRoute(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);
      assertGetRouteResult(
        result,
        [[uniqueTokenPairSorted]],
        uniqueTokenPair.tokenMintA,
        uniqueTokenPair.tokenMintB
      );
    });

    it("1 route with 2 hops exist - verify edge ordering correct", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getRoute(rlbSolPool.tokenMintB, mSolSolPool.tokenMintB);
      assertGetRouteResult(
        result,
        [[rlbSolPool, mSolSolPool]],
        rlbSolPool.tokenMintB,
        mSolSolPool.tokenMintB
      );
    });

    it("1 route with 2 hops exist - verify edge ordering correct (reverse)", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getRoute(mSolSolPool.tokenMintB, rlbSolPool.tokenMintB);
      assertGetRouteResult(
        result,
        [[mSolSolPool, rlbSolPool]],
        mSolSolPool.tokenMintB,
        rlbSolPool.tokenMintB
      );
    });

    it("1 tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getRoute(rlbSolPool.tokenMintB, mSolSolPool.tokenMintB);
      assertGetRouteResult(
        result,
        [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ],
        rlbSolPool.tokenMintB,
        mSolSolPool.tokenMintB
      );
    });

    it("only allow 2-hop routes that go through tokens from the intermediate token list ", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getRoute(rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB, {
        intermediateTokens: [rlbUsdcPool.tokenMintA],
      });
      assertGetRouteResult(
        result,
        [[rlbUsdcPool, msolUsdcPool]],
        rlbUsdcPool.tokenMintB,
        msolUsdcPool.tokenMintB
      );
    });
  });
});

function assertGetAllRoutesResult(
  searchResultEntires: RouteSearchEntires,
  expectedRoutes: [string, PoolTokenPair[][]][]
) {

  assert.equal(searchResultEntires.length, expectedRoutes.length, `Number of routes should match expected routes`);

  searchResultEntires.forEach((searchEntry, entryIndex) => {
    const [routeId, routes] = searchEntry;
    const dRouteId = PoolGraphUtils.deconstructRouteId(routeId);
    if (!dRouteId) {
      throw new Error(`assertGetAllRoutesResult - Invalid routeId at entry ${entryIndex} of route (${routeId})`);
    }
    const [startMint, endMint] = dRouteId;

    // Assert route is correct
    const expectedRoutesForEntry = expectedRoutes[entryIndex];

    assert.equal(
      routes.length,
      expectedRoutesForEntry[1].length,
      "Expected number of paths to match expected pools"
    );

    assertGetRouteResult(routes, expectedRoutesForEntry[1], startMint, endMint);
  })
}

function assertGetRouteResult(
  routes: Route[],
  expectedRoutes: PoolTokenPair[][],
  expectedStartMint: Address,
  expectedEndMint: Address
) {
  assert.equal(routes.length, expectedRoutes.length);
  routes.forEach((route, routeIndex) => {
    assertRoute(route, routeIndex, expectedStartMint, expectedEndMint, expectedRoutes);
  });
}

function assertRoute(
  route: Route,
  routeIndex: number,
  expectedStartMint: Address,
  expectedEndMint: Address,
  expectedRoutes: PoolTokenPair[][]
) {
  assert.equal(route.startTokenMint, AddressUtil.toString(expectedStartMint));
  assert.equal(route.endTokenMint, AddressUtil.toString(expectedEndMint));

  const expectedRoute = expectedRoutes[routeIndex];
  assert.equal(
    route.hops.length,
    expectedRoute.length,
    `Expected number of edges to match expected pools at index ${routeIndex}`
  );
  route.hops.forEach((hop, hopIndex) => {
    assert.equal(
      AddressUtil.toString(hop.poolAddress),
      AddressUtil.toString(expectedRoutes[routeIndex][hopIndex].address),
      `Expected edge pool address to match expected pool addr at hop index ${hopIndex}`
    );
  });
}
