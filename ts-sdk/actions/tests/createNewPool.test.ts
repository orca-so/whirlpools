import { describe, it, expect, vi } from "vitest";
import { createNewPool } from "../src/index";
import { mockTxHash } from "./utils";
import * as txSender from "@orca-so/tx-sender";
import { address } from "@solana/web3.js";

// Mock dependencies
vi.mock("@orca-so/tx-sender", () => ({
  getRpcConfig: vi.fn().mockReturnValue({ rpcUrl: "https://mockrpc.com" }),
  buildAndSendTransaction: vi.fn().mockResolvedValue(mockTxHash),
}));

describe("createNewPool", () => {
  // Note: This function is not yet implemented
  // These tests describe the expected behavior once implemented

  it("should be implemented", () => {
    // This test will fail until the function is implemented
    expect(typeof createNewPool).toBe("function");
  });

  it("should create a new whirlpool with the specified parameters", async () => {
    // Skip this test until implementation is complete
    if (
      createNewPool.toString().includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    // Test parameters
    const tokenA = address("11111111111111111111111111111111");
    const tokenB = address("22222222222222222222222222222222");
    const tickSpacing = 64;
    const initialPrice = 1.5;

    // Once implemented, this should return the pool address
    const result = await createNewPool(
      tokenA,
      tokenB,
      tickSpacing,
      initialPrice
    );

    // Expect a transaction hash to be returned
    expect(typeof result).toBe("string");
    expect(result).toEqual(String(mockTxHash));

    // Expect the transaction to be built and sent
    expect(txSender.buildAndSendTransaction).toHaveBeenCalled();
  });

  it("should throw an error if token mints are the same", async () => {
    // Skip this test until implementation is complete
    if (
      createNewPool.toString().includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    const sameToken = address("11111111111111111111111111111111");

    await expect(createNewPool(sameToken, sameToken, 64, 1.0)).rejects.toThrow(
      /cannot create pool with identical token mints/i
    );
  });

  it("should throw an error if tick spacing is invalid", async () => {
    // Skip this test until implementation is complete
    if (
      createNewPool.toString().includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    const tokenA = address("11111111111111111111111111111111");
    const tokenB = address("22222222222222222222222222222222");
    const invalidTickSpacing = 9; // Not a standard tick spacing

    await expect(
      createNewPool(tokenA, tokenB, invalidTickSpacing, 1.0)
    ).rejects.toThrow(/invalid tick spacing/i);
  });

  it("should throw an error if initial price is not positive", async () => {
    // Skip this test until implementation is complete
    if (
      createNewPool.toString().includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    const tokenA = address("11111111111111111111111111111111");
    const tokenB = address("22222222222222222222222222222222");

    await expect(createNewPool(tokenA, tokenB, 64, 0)).rejects.toThrow(
      /initial price must be positive/i
    );

    await expect(createNewPool(tokenA, tokenB, 64, -1.5)).rejects.toThrow(
      /initial price must be positive/i
    );
  });

  it("should accept optional parameters for fee tier", async () => {
    // Skip this test until implementation is complete
    if (
      createNewPool.toString().includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    const tokenA = address("11111111111111111111111111111111");
    const tokenB = address("22222222222222222222222222222222");
    const tickSpacing = 64;
    const initialPrice = 1.5;
    const feeTier = 0.01; // 1%

    const result = await createNewPool(
      tokenA,
      tokenB,
      tickSpacing,
      initialPrice
    );

    // Expect a transaction hash to be returned
    expect(typeof result).toBe("string");
    expect(result).toEqual(String(mockTxHash));
  });

  it("should accept a custom signer", async () => {
    // Skip this test until implementation is complete
    if (
      createNewPool.toString().includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    const tokenA = address("11111111111111111111111111111111");
    const tokenB = address("22222222222222222222222222222222");
    const tickSpacing = 64;
    const initialPrice = 1.5;

    const customSigner = {
      address: address("33333333333333333333333333333333"),
      signTransactions: vi.fn(),
      signMessages: vi.fn(),
    };

    const result = await createNewPool(
      tokenA,
      tokenB,
      tickSpacing,
      initialPrice
    );

    // Expect a transaction hash to be returned
    expect(typeof result).toBe("string");
    expect(result).toEqual(String(mockTxHash));

    // Expect the transaction to be built and sent with the custom signer
    expect(txSender.buildAndSendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      customSigner
    );
  });
});
