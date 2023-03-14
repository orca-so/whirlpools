import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import * as assert from "assert";
import { PoolGraphBuilder, PoolGraphUtils, PoolTokenPair, Route } from "../../../../src";
import {
  solConnectedPools,
  uniqueTokenMintsGraphData,
  uniqueTokenMintsGraphTokenUnsortedData,
  usdcConnectedPools
} from "../../../utils/graph-test-data";

describe("PoolGraph tests", () => {
  describe("getAllRoutes", () => {
    it("Route does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const results = graph.getAllRoutes([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      assert.equal(Object.entries(results).length, 0);
    });

    it("1 route exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphData[0];
      const results = graph.getAllRoutes([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      const resultEntries = Object.entries(results);
      assert.equal(resultEntries.length, 1);

      assertGetAllRoutesResult(resultEntries[0], [[uniqueTokenPair]]);
    });

    it("1 route exist - token ordering reversed", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphTokenUnsortedData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const uniqueTokenPairSorted = uniqueTokenMintsGraphData[0];
      const results = graph.getAllRoutes([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      const resultEntries = Object.entries(results);
      assert.equal(resultEntries.length, 1);
      assertGetAllRoutesResult(resultEntries[0], [[uniqueTokenPairSorted]]);
    });

    it("1 route with 2 hops exist - verify edge ordering correct", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];
      const results = graph.getAllRoutes([[rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]]);
      const resultEntries = Object.entries(results);

      assert.equal(resultEntries.length, 1);

      assertGetAllRoutesResult(resultEntries[0], [[rlbSolPool, mSolSolPool]]);
    });

    it("1 route with 2 hops exist - verify edge ordering correct (reverse)", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];
      const results = graph.getAllRoutes([[mSolSolPool.tokenMintB, rlbSolPool.tokenMintB]]);
      const resultEntries = Object.entries(results);

      assert.equal(resultEntries.length, 1);

      assertGetAllRoutesResult(resultEntries[0], [[mSolSolPool, rlbSolPool]]);
    });

    it("1 tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];
      const results = graph.getAllRoutes([[rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]]);
      const resultEntries = Object.entries(results);

      assert.equal(resultEntries.length, 1);
      const rlbUsdcPool = usdcConnectedPools[0];
      const msolUsdcPool = usdcConnectedPools[1];

      assertGetAllRoutesResult(resultEntries[0], [
        [rlbSolPool, mSolSolPool],
        [rlbUsdcPool, msolUsdcPool],
      ]);
    });

    it("only allow 2-hop routes that go through tokens from the intermediate token list ", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const rlbUsdcPool = usdcConnectedPools[0];
      const msolUsdcPool = usdcConnectedPools[1];
      const results = graph.getAllRoutes([[rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB]], {
        intermediateTokens: [rlbUsdcPool.tokenMintA],
      });
      const resultEntries = Object.entries(results);

      // Assert that the SOL routes are filtered out
      assert.equal(resultEntries.length, 1);
      assertGetAllRoutesResult(resultEntries[0], [[rlbUsdcPool, msolUsdcPool]]);
    });

    it("multiple tokenPair input to multiple routes exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];
      const dustSolPool = solConnectedPools[2];

      const results = graph.getAllRoutes([
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [dustSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]);
      const resultEntries = Object.entries(results);

      assert.equal(resultEntries.length, 2);
      const rlbUsdcPool = usdcConnectedPools[0];
      const msolUsdcPool = usdcConnectedPools[1];
      const dustUsdcPool = usdcConnectedPools[2];

      const expectedRoutesForTokenPairQueries = [
        [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ],
        [
          [dustSolPool, mSolSolPool],
          [dustUsdcPool, msolUsdcPool],
        ],
      ];

      resultEntries.forEach((route, index) =>
        assertGetAllRoutesResult(route, expectedRoutesForTokenPairQueries[index])
      );
    });
  });

  describe("getRoute", async () => {
    it("Route does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const result = graph.getRoute(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);
      assert.equal(result.length, 0);
    });

    it("1 route exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphData[0];
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
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const uniqueTokenPairSorted = uniqueTokenMintsGraphData[0];
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
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];

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
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];

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
      const rlbSolPool = solConnectedPools[0];
      const mSolSolPool = solConnectedPools[1];
      const rlbUsdcPool = usdcConnectedPools[0];
      const msolUsdcPool = usdcConnectedPools[1];

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
  });

  it("only allow 2-hop routes that go through tokens from the intermediate token list ", async () => {
    const testData = [...solConnectedPools, ...usdcConnectedPools];
    const graph = PoolGraphBuilder.buildPoolGraph(testData);
    const rlbUsdcPool = usdcConnectedPools[0];
    const msolUsdcPool = usdcConnectedPools[1];
    const result = graph.getRoute(rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB, {
      intermediateTokens: [rlbUsdcPool.tokenMintA],
    });
    assertGetRouteResult(
      result,
      [
        [rlbUsdcPool, msolUsdcPool],
      ],
      rlbUsdcPool.tokenMintB,
      msolUsdcPool.tokenMintB
    );
  });

});

function assertGetAllRoutesResult(
  [routeId, routes]: [string, Route[]],
  expectedRoutes: PoolTokenPair[][]
) {
  const deconstructRouteId = PoolGraphUtils.deconstructRouteId(routeId);

  if (!deconstructRouteId) {
    assert.fail("Invalid routeId");
  }

  assert.equal(
    routes.length,
    expectedRoutes.length,
    "Expected number of paths to match expected pools"
  );

  // Assert that the routeId is correct
  const [startMint, endMint] = deconstructRouteId;
  assert.equal(startMint, routes[0].startMint);
  assert.equal(endMint, routes[0].endMint);

  assert.equal(routes.length, expectedRoutes.length);

  // Assert that the paths is correct
  routes.forEach((path, pathIndex) => {
    assertRoute(path, pathIndex, startMint, endMint, expectedRoutes);
  });
}

function assertGetRouteResult(
  routes: Route[],
  expectedRoutes: PoolTokenPair[][],
  expectedStartMint: Address,
  expectedEndMint: Address
) {
  assert.equal(routes.length, expectedRoutes.length);
  routes.forEach((path, pathIndex) => {
    assertRoute(path, pathIndex, expectedStartMint, expectedEndMint, expectedRoutes);
  });
}

function assertRoute(
  path: Route,
  pathIndex: number,
  expectedStartMint: Address,
  expectedEndMint: Address,
  expectedRoutes: PoolTokenPair[][]
) {
  assert.equal(path.startMint, AddressUtil.toString(expectedStartMint));
  assert.equal(path.endMint, AddressUtil.toString(expectedEndMint));

  const expectedPath = expectedRoutes[pathIndex];
  assert.equal(
    path.edges.length,
    expectedPath.length,
    `Expected number of edges to match expected pools at index ${pathIndex}`
  );
  path.edges.forEach((edge, edgeIndex) => {
    assert.equal(
      edge,
      expectedRoutes[pathIndex][edgeIndex].address,
      `Expected edge pool address to match expected pool addr at index ${edgeIndex}`
    );
  });
}
