import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import * as assert from "assert";
import { Path, PathSearchEntries, PoolGraphBuilder, PoolGraphUtils, PoolTokenPair } from "../../../../src";
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
  describe("getPathsForPairs", () => {
    it("Path does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphTokenUnsortedData[0];
      const results = graph.getPathsForPairs([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      assert.equal(results.length, 1);
      const searchId = PoolGraphUtils.getSearchPathId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertGetPathsForPairsResult(results, [[searchId, []]]);
    });

    it("Path between the same token mint", async () => {
      const testData = [...solConnectedPools, ...feeTierPoolsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [usdcMint, usdcMint]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);
      assert.equal(results.length, 1);

      const searchId = PoolGraphUtils.getSearchPathId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintA);

      assertGetPathsForPairsResult(results, [[searchId, []]]);
    })

    it("1 path exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);
      assert.equal(results.length, 1);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPair]
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("1 path exist - token ordering reversed", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphTokenUnsortedData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPairSorted]
        ]]];
      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("1 path with 2 edges exist - verify edge ordering correct", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);


      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool]
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("1 path with 2 edges exist - verify edge ordering correct (reverse)", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [mSolSolPool.tokenMintB, rlbSolPool.tokenMintB]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [mSolSolPool, rlbSolPool]
        ]]];
      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("1 tokenPair input to multiple paths exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);

      assert.equal(results.length, 1);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("duplicated token-pairs will still be executed and ordered in results", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]

      const results = graph.getPathsForPairs(searchTokenPairs);
      assert.equal(results.length, 2);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]],
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[1][0], searchTokenPairs[1][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("same token-pairs but with reversed order has unique search ids", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [mSolSolPool.tokenMintB, rlbSolPool.tokenMintB],
      ]

      const results = graph.getPathsForPairs(searchTokenPairs);
      assert.equal(results.length, 2);

      // TODO: Directionality of the edges is not being considered
      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]],
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[1][0], searchTokenPairs[1][1]), [
          [mSolSolPool, rlbSolPool],
          [msolUsdcPool, rlbUsdcPool],
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("only allow 2-edge paths that go through tokens from the intermediate token list ", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB]
      ];
      const results = graph.getPathsForPairs(searchTokenPairs, {
        intermediateTokens: [rlbUsdcPool.tokenMintA],
      });

      // Assert that the SOL paths are filtered out
      assert.equal(results.length, 1);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbUsdcPool, msolUsdcPool]
        ]]
      ];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });

    it("multiple tokenPair input to multiple paths exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [rlbSolPool.tokenMintB, mSolSolPool.tokenMintB],
        [dustSolPool.tokenMintB, mSolSolPool.tokenMintB],
      ]

      const results = graph.getPathsForPairs(searchTokenPairs);

      assert.equal(results.length, 2);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ]],
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[1][0], searchTokenPairs[1][1]), [
          [dustSolPool, mSolSolPool],
          [dustUsdcPool, msolUsdcPool],
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries)
    });
  });

  describe("getPath", async () => {
    it("Path does not exist", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const result = graph.getPath(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);
      assert.equal(result.length, 0);
    });

    it("1 path exist", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const result = graph.getPath(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertGetPathResult(
        result,
        [[uniqueTokenPair]],
        uniqueTokenPair.tokenMintA,
        uniqueTokenPair.tokenMintB
      );
    });

    it("1 path exist - token ordering reversed", async () => {
      const testData = [...solConnectedPools, ...uniqueTokenMintsGraphTokenUnsortedData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getPath(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);
      assertGetPathResult(
        result,
        [[uniqueTokenPairSorted]],
        uniqueTokenPair.tokenMintA,
        uniqueTokenPair.tokenMintB
      );
    });

    it("Path between the same token mint", async () => {
      const testData = [...solConnectedPools, ...feeTierPoolsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const results = graph.getPath(usdcMint, usdcMint);

      assertGetPathResult(results, [], usdcMint, usdcMint);
    })

    it("1 path with 2 edges exist - verify edge ordering correct", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getPath(rlbSolPool.tokenMintB, mSolSolPool.tokenMintB);
      assertGetPathResult(
        result,
        [[rlbSolPool, mSolSolPool]],
        rlbSolPool.tokenMintB,
        mSolSolPool.tokenMintB
      );
    });

    it("1 path with 2 edges exist - verify edge ordering correct (reverse)", async () => {
      const testData = [...solConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getPath(mSolSolPool.tokenMintB, rlbSolPool.tokenMintB);
      assertGetPathResult(
        result,
        [[mSolSolPool, rlbSolPool]],
        mSolSolPool.tokenMintB,
        rlbSolPool.tokenMintB
      );
    });

    it("1 tokenPair input to multiple paths exist - verify token order, edge ordering", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getPath(rlbSolPool.tokenMintB, mSolSolPool.tokenMintB);
      assertGetPathResult(
        result,
        [
          [rlbSolPool, mSolSolPool],
          [rlbUsdcPool, msolUsdcPool],
        ],
        rlbSolPool.tokenMintB,
        mSolSolPool.tokenMintB
      );
    });

    it("only allow 2-edge paths that go through tokens from the intermediate token list ", async () => {
      const testData = [...solConnectedPools, ...usdcConnectedPools];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const result = graph.getPath(rlbUsdcPool.tokenMintB, msolUsdcPool.tokenMintB, {
        intermediateTokens: [rlbUsdcPool.tokenMintA],
      });
      assertGetPathResult(
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
      const results = graph.getPathsForPairs([
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
      ]);
      assert.equal(results.length, 1);
      const searchId = PoolGraphUtils.getSearchPathId(uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB);

      assertGetPathsForPairsResult(results, [[searchId, []]]);
    });

    it("Duplicate pool data in input should not affect output", async () => {
      const testData = [...solConnectedPools, ...solConnectedPools, ...uniqueTokenMintsGraphData];
      const graph = PoolGraphBuilder.buildPoolGraph(testData);

      const searchTokenPairs: [Address, Address][] = [
        [uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB],
        [rlbSolPool.tokenMintA, rlbSolPool.tokenMintB]
      ]
      const results = graph.getPathsForPairs(searchTokenPairs);

      assert.equal(results.length, 2);

      const expectedPathsForTokenPairQueries: [string, PoolTokenPair[][]][] = [
        [PoolGraphUtils.getSearchPathId(searchTokenPairs[0][0], searchTokenPairs[0][1]), [
          [uniqueTokenPair]
        ]], [PoolGraphUtils.getSearchPathId(rlbSolPool.tokenMintA, rlbSolPool.tokenMintB), [
          [rlbSolPool]
        ]]];

      assertGetPathsForPairsResult(results, expectedPathsForTokenPairQueries);
    });
  });
});

function assertGetPathsForPairsResult(
  searchResultEntires: PathSearchEntries,
  expectedPaths: [string, PoolTokenPair[][]][]
) {

  assert.equal(searchResultEntires.length, expectedPaths.length, `Number of paths should match expected paths`);

  searchResultEntires.forEach((searchEntry, entryIndex) => {
    const [pathId, paths] = searchEntry;
    const [startMint, endMint] = PoolGraphUtils.deconstructPathId(pathId);

    // Assert path is correct
    const expectedPathsForEntry = expectedPaths[entryIndex];

    assert.equal(
      paths.length,
      expectedPathsForEntry[1].length,
      "Expected number of paths to match expected pools"
    );

    assertGetPathResult(paths, expectedPathsForEntry[1], startMint, endMint);
  })
}

function assertGetPathResult(
  paths: Path[],
  expectedPaths: PoolTokenPair[][],
  expectedStartMint: Address,
  expectedEndMint: Address
) {
  assert.equal(paths.length, expectedPaths.length);
  paths.forEach((path, pathIndex) => {
    assertPath(path, pathIndex, expectedStartMint, expectedEndMint, expectedPaths);
  });
}

function assertPath(
  path: Path,
  pathIndex: number,
  expectedStartMint: Address,
  expectedEndMint: Address,
  expectedPaths: PoolTokenPair[][]
) {
  assert.equal(path.startTokenMint, AddressUtil.toString(expectedStartMint));
  assert.equal(path.endTokenMint, AddressUtil.toString(expectedEndMint));

  const expectedPath = expectedPaths[pathIndex];
  assert.equal(
    path.edges.length,
    expectedPath.length,
    `Expected number of edges to match expected pools at index ${pathIndex}`
  );
  path.edges.forEach((edge, edgeIndex) => {
    assert.equal(
      AddressUtil.toString(edge.poolAddress),
      AddressUtil.toString(expectedPaths[pathIndex][edgeIndex].address),
      `Expected edge pool address to match expected pool addr at edge index ${edgeIndex}`
    );
  });
}
