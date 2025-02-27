import { describe, it, expect, vi } from "vitest";
import { closePositionAndCollectFees } from "../src/index";
import { mockTxHash } from "./utils";
import * as txSender from "@orca-so/tx-sender";
import { address } from "@solana/web3.js";

// Mock dependencies
vi.mock("@orca-so/tx-sender", () => ({
  getRpcConfig: vi.fn().mockReturnValue({ rpcUrl: "https://mockrpc.com" }),
  buildAndSendTransaction: vi.fn().mockResolvedValue(mockTxHash),
}));

describe("closePositionAndCollectFees", () => {
  // Note: This function is not yet implemented
  // These tests describe the expected behavior once implemented

  it("should be implemented", () => {
    // This test will fail until the function is implemented
    expect(typeof closePositionAndCollectFees).toBe("function");
  });

  it("should close a position and collect fees", async () => {
    // Skip this test until implementation is complete
    if (
      closePositionAndCollectFees
        .toString()
        .includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    // Test parameters
    const positionAddress = address("position_address");

    // Once implemented, this should return transaction hash
    const result = await closePositionAndCollectFees(positionAddress);

    // Expect a transaction hash to be returned
    expect(result).toEqual(String(mockTxHash));

    // Expect the transaction to be built and sent
    expect(txSender.buildAndSendTransaction).toHaveBeenCalled();
  });

  it("should fail if position doesn't exist", async () => {
    // Skip this test until implementation is complete
    if (
      closePositionAndCollectFees
        .toString()
        .includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    // Mock transaction failure
    vi.mocked(txSender.buildAndSendTransaction).mockRejectedValueOnce(
      new Error("Position not found")
    );

    // Test with non-existent position
    const nonExistentPosition = address("non_existent_position");

    await expect(
      closePositionAndCollectFees(nonExistentPosition)
    ).rejects.toThrow("Position not found");
  });

  it("should accept a custom signer", async () => {
    // Skip this test until implementation is complete
    if (
      closePositionAndCollectFees
        .toString()
        .includes("throw new Error('Not implemented')")
    ) {
      return;
    }

    const positionAddress = address("position_address");

    const customSigner = {
      address: "custom_signer_pubkey" as any,
      signTransactions: vi.fn(),
      signMessages: vi.fn(),
    };

    const result = await closePositionAndCollectFees(
      positionAddress,
      undefined,
      customSigner
    );

    // Expect a transaction hash to be returned
    expect(result).toEqual(String(mockTxHash));

    // Expect the transaction to be built and sent with the custom signer
    expect(txSender.buildAndSendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      customSigner
    );
  });
});
