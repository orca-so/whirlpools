import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import * as assert from "assert";
import { PoolGraphBuilder, PoolGraphUtils, PoolTokenPair, Route, RouteSearchEntries } from "../../../../src";
import {
  feeTierPoolsGraphData,
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
const usdcMint: Address = feeTierPoolsGraphData[0].tokenMintB;

describe.only("PoolGraph tests", () => {
  describe("getRoutesForPairs", () => {
    it("Route does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const results = graph.getRoutesForPairs([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      assert.equal(results.length, 1);
      const searchId = PoolGraphUtils.getSearchRouteId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertgetRoutesForPairsResult(results, [[searchId, []]]);
    });

    it("Route between the same token mint", async () => {
      const testData = [...solConnectedPools, ...feeTierPoolsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [usdcMint, usdcMint]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);
      assert.equal(results.length, 1);

      const searchId = PoolGraphUtils.getSearchRouteId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintA);

      assertgetRoutesForPairsResult(results, [[searchId, []]]);
    })

    it("1 route exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);
      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPair]
        ]]];

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 route exist - token ordering reversed", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphTokenUnsortedData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPairSorted]
        ]]];
      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 route with 2 hops exist - verify edge ordering correct", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool]
        ]]];

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("assert caching layer returns the same route on same call", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);
      const cachedResult = graph.getRoutesForPairs(searchTokenPairs);

      assert.equal(results.length, 1);
      assert.equal(cachedResult.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool]
        ]]];

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
      assertgetRoutesForPairsResult(cachedResult, expectedRoutesForTokenPairQueries);
    });

    it("1 route with 2 hops exist - verify edge ordering correct (reverse)", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [mSolSolPool.tokenMintB, rlbSolPool.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [mSolSolPool, rlbSolPool]
        ]]];
      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("1 tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]]];

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("duplicated token-pairs will still be executed and ordered in results", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]

      const results = graph.getRoutesForPairs(searchTokenPairs);
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

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("same token-pairs but with reversed order has unique search ids", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [mSolSolPool.tokenMintB, rlbSolPool.tokenMintB],
      ]

      const results = graph.getRoutesForPairs(searchTokenPairs);
      assert.equal(results.length, 2);

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

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("only allow 2-hop routes that go through tokens from the intermediate token list ", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB]
      ];
      const results = graph.getRoutesForPairs(searchTokenPairs, {
        intermediateTokens: [rlbUsdcPool.tokenMintA],
      });

      // Assert that the SOL routes are filtered out
      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbUsdcPool, msolUsdcPool]
        ]]
      ];

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });

    it("multiple tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [dustSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]

      const results = graph.getRoutesForPairs(searchTokenPairs);

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

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries)
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

    it("Route between the same token mint", async () => {
      const testData = [...solConnectedPools, ...feeTierPoolsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const results = graph.getRoute(usdcMint, usdcMint);

      assertGetRouteResult(results, [], usdcMint, usdcMint);
    })

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

    it("assert caching layer returns the same value on second call", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getRoute(rlbSolPool.tokenMintB, mSolSolPool.tokenMintB);
      const cachedResult = graph.getRoute(rlbSolPool.tokenMintB, mSolSolPool.tokenMintB);

      const expected = [
        [rlbSolPool, mSolSolPool],
        [rlbUsdcPool, msolUsdcPool],
      ];
      assertGetRouteResult(
        result,
        expected,
        rlbSolPool.tokenMintB,
        mSolSolPool.tokenMintB
      );
      assertGetRouteResult(
        cachedResult,
        expected,
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

  describe("Pool graph edge cases", () => {
    it("Zero pools in graph should not return any results", async () => {
      const graph = PoolGraphBuilder.buildPoolGraph([]);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const results = graph.getRoutesForPairs([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      assert.equal(results.length, 1);
      const searchId = PoolGraphUtils.getSearchRouteId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertgetRoutesForPairsResult(results, [[searchId, []]]);
    });

    it("Duplicate pool data in input should not affect output", async () => {
      const testData = [...solConnectedPools, ...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getRoutesForPairs(searchTokenPairs);
      assert.equal(results.length, 1);

      const expectedRoutesForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchRouteId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPair]
        ]]];

      assertgetRoutesForPairsResult(results, expectedRoutesForTokenPairQueries);
    });
  });
});

function assertgetRoutesForPairsResult(
  searchResultEntires: RouteSearchEntries,
  expectedRoutes: [string, PoolTokenPair[][]][]
) {

  assert.equal(searchResultEntires.length, expectedRoutes.length, `Number of routes should match expected routes`);

  searchResultEntires.forEach((searchEntry, entryIndex) => {
    const [routeId, routes] = searchEntry;
    const [startMint, endMint] = PoolGraphUtils.deconstructRouteId(routeId);

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
