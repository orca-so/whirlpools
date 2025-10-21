import { describe, it, vi, beforeEach } from "vitest";
import { setRpc, getRpcConfig } from "../src/config";
import assert from "assert";
import { setupMockRpc } from "./utils/mockRpc";

const rpcUrl = "https://api.mainnet-beta.solana.com";

describe("Config Tests", () => {
  describe("getRpcConfig - uninitialized state", () => {
    it("Should throw error when RPC is not initialized", () => {
      assert.throws(
        () => getRpcConfig(),
        /Connection not initialized. Call setRpc\(\) first/,
        "Should throw error when RPC not initialized",
      );
    });
  });

  describe("setRpc and getRpcConfig - initialized state", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      setupMockRpc();
    });

    describe("setRpc", () => {
      it("Should return a valid RPC object that can be used", async () => {
        const rpc = await setRpc(rpcUrl);

        assert.ok(rpc, "rpc should not be undefined");
        assert.ok(
          typeof rpc.getSlot === "function",
          "rpc should have getSlot method",
        );
        assert.ok(
          typeof rpc.getLatestBlockhash === "function",
          "rpc should have getLatestBlockhash method",
        );
        assert.ok(
          typeof rpc.getGenesisHash === "function",
          "rpc should have getGenesisHash method",
        );
        assert.ok(
          typeof rpc.getBlockHeight === "function",
          "rpc should have getBlockHeight method",
        );
      });

      it("Should return a functional RPC object that can make calls", async () => {
        const rpc = await setRpc(rpcUrl);

        const slot = await rpc.getSlot().send();
        assert.ok(typeof slot === "bigint", "getSlot should return a bigint");
        assert.strictEqual(
          slot,
          BigInt(123456789),
          "getSlot should return the mocked value",
        );

        const blockHeight = await rpc.getBlockHeight().send();
        assert.ok(
          typeof blockHeight === "bigint",
          "getBlockHeight should return a bigint",
        );
        assert.strictEqual(
          blockHeight,
          BigInt(987654321),
          "getBlockHeight should return the mocked value",
        );

        const latestBlockhash = await rpc.getLatestBlockhash().send();
        assert.ok(latestBlockhash, "getLatestBlockhash should return a value");
        assert.strictEqual(
          latestBlockhash.value.blockhash,
          "123456789abcdef",
          "should return the mocked blockhash",
        );

        const genesisHash = await rpc.getGenesisHash().send();
        assert.ok(
          typeof genesisHash === "string",
          "getGenesisHash should return a string",
        );
        assert.strictEqual(
          genesisHash,
          "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
          "should return the mocked genesis hash",
        );
      });

      it("Should set the global RPC config correctly", async () => {
        await setRpc(rpcUrl, {
          supportsPriorityFeePercentile: true,
        });

        const config = getRpcConfig();
        assert.strictEqual(
          config.rpcUrl,
          rpcUrl,
          "RPC URL should be set correctly",
        );
        assert.strictEqual(
          config.supportsPriorityFeePercentile,
          true,
          "Priority fee percentile support should be set correctly",
        );
        assert.ok(config.chainId, "Chain ID should be set");
        assert.strictEqual(
          config.pollIntervalMs,
          0,
          "Poll interval should use default",
        );
        assert.strictEqual(
          config.resendOnPoll,
          true,
          "Resend on poll should use default",
        );
      });

      it("Should handle different priority fee percentile settings", async () => {
        const rpc1 = await setRpc(rpcUrl, {
          supportsPriorityFeePercentile: false,
        });
        let config = getRpcConfig();
        assert.strictEqual(
          config.supportsPriorityFeePercentile,
          false,
          "Priority fee percentile should be disabled",
        );

        const rpc2 = await setRpc(rpcUrl, {
          supportsPriorityFeePercentile: true,
        });
        config = getRpcConfig();
        assert.strictEqual(
          config.supportsPriorityFeePercentile,
          true,
          "Priority fee percentile should be enabled",
        );

        assert.ok(rpc1, "First RPC object should be valid");
        assert.ok(rpc2, "Second RPC object should be valid");
      });

      it("Should handle RPC usage configuration", async () => {
        await setRpc(rpcUrl, {
          pollIntervalMs: 1000,
          resendOnPoll: false,
        });

        const config = getRpcConfig();
        assert.strictEqual(
          config.pollIntervalMs,
          1000,
          "Poll interval should be set",
        );
        assert.strictEqual(
          config.resendOnPoll,
          false,
          "Resend on poll should be set",
        );
      });

      it("Should create RPC objects that are not thenable", async () => {
        const rpc = await setRpc(rpcUrl);

        assert.strictEqual(
          Object.hasOwnProperty.call(rpc, "then"),
          false,
          "RPC object should not have a 'then' property",
        );
        assert.strictEqual(
          "then" in rpc,
          false,
          "RPC object should not be thenable",
        );
      });
    });

    describe("getRpcConfig", () => {
      it("Should return correct config after setRpc", async () => {
        await setRpc(rpcUrl, {
          supportsPriorityFeePercentile: true,
        });

        const config = getRpcConfig();
        assert.strictEqual(config.rpcUrl, rpcUrl);
        assert.strictEqual(config.supportsPriorityFeePercentile, true);
        assert.ok(config.chainId);
      });
    });
  });
});
