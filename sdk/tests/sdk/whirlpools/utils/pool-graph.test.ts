import * as assert from "assert";
import { PoolGraphBuilder } from "../../../../src";
import { solConnectedPools, uniqueTokenMintsGraphData } from "../../../utils/graph-test-data";

describe.only("PoolGraph tests", () => {
  describe("getAllRoutes", () => {
    it("Route does not exist", async () => {
      const testData = [
        ...solConnectedPools,
      ]
      const graph = PoolGraphBuilder.buildPoolGraph(testData);
      const uniqueTokenPair = uniqueTokenMintsGraphData[0];
      const results = graph.getAllRoutes([[uniqueTokenPair.tokenMintA, uniqueTokenPair.tokenMintB]])
      assert.equal(results.length, 0);
    });
  });
});