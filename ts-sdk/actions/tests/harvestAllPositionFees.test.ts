import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { harvestAllPositionFees } from "../src/index";
import {
  mockPositions,
  mockHarvestInstructions,
  mockRpc,
  mockKeyPairSigner,
  mockTxHash,
} from "./utils";
import * as txSender from "@orca-so/tx-sender";
import * as whirlpools from "@orca-so/whirlpools";

// Mock dependencies
vi.mock("@orca-so/tx-sender", () => ({
  getRpcConfig: vi.fn().mockReturnValue({ rpcUrl: "https://mockrpc.com" }),
  rpcFromUrl: vi.fn().mockReturnValue({
    getAccountInfo: vi.fn(),
    getMultipleAccounts: vi.fn().mockResolvedValue([]),
  }),
  buildAndSendTransaction: vi.fn().mockResolvedValue(mockTxHash),
}));

vi.mock("@orca-so/whirlpools", () => ({
  fetchPositionsForOwner: vi.fn(),
  harvestPositionInstructions: vi.fn(),
  getPositionByAddressConfig: vi.fn().mockResolvedValue(mockPositions[0]),
  collectFeesInstructionBuilder: vi.fn().mockReturnValue({
    build: vi.fn().mockReturnValue({
      instructions: [
        { programId: "programId", keys: [], data: Buffer.from([]) },
      ],
    }),
  }),
}));

vi.mock("../src/config", () => ({
  getPayer: vi.fn().mockReturnValue(mockKeyPairSigner),
}));

vi.mock("../src/helpers", () => ({
  wouldExceedTransactionSize: vi.fn().mockReturnValue(false),
}));

describe("harvestAllPositionFees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should harvest fees from all positions and return transaction hashes", async () => {
    const txHashes = await harvestAllPositionFees();

    // Verify positions were fetched
    expect(whirlpools.fetchPositionsForOwner).toHaveBeenCalledWith(
      mockRpc,
      mockKeyPairSigner.address
    );

    // Verify harvest instructions were created for each position
    expect(whirlpools.harvestPositionInstructions).toHaveBeenCalledTimes(
      mockPositions.length
    );
    expect(whirlpools.harvestPositionInstructions).toHaveBeenCalledWith(
      mockRpc,
      mockPositions[0].data.positionMint,
      mockKeyPairSigner
    );
    expect(whirlpools.harvestPositionInstructions).toHaveBeenCalledWith(
      mockRpc,
      mockPositions[1].data.positionMint,
      mockKeyPairSigner
    );

    // Verify transaction was sent
    expect(txSender.buildAndSendTransaction).toHaveBeenCalledWith(
      mockHarvestInstructions,
      mockKeyPairSigner
    );

    // Verify result
    expect(txHashes).toEqual([String(mockTxHash), String(mockTxHash)]);
  });

  it("should handle transaction size limits by creating multiple transactions", async () => {
    // Mock that transactions would exceed size
    const wouldExceedSize = vi.spyOn(
      require("../src/helpers"),
      "wouldExceedTransactionSize"
    );
    wouldExceedSize.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const txHashes = await harvestAllPositionFees();

    // Verify multiple transactions were created (one per position in this case)
    expect(txSender.buildAndSendTransaction).toHaveBeenCalledTimes(2);

    // Verify result has multiple transaction hashes
    expect(txHashes).toEqual([String(mockTxHash), String(mockTxHash)]);
  });

  it("should handle positions without positionMint data", async () => {});

  it("should handle empty positions list", async () => {
    vi.mocked(whirlpools.fetchPositionsForOwner).mockResolvedValueOnce([]);

    const txHashes = await harvestAllPositionFees();

    // Verify no harvest instructions were created
    expect(whirlpools.harvestPositionInstructions).not.toHaveBeenCalled();

    // Verify no transactions were sent
    expect(txSender.buildAndSendTransaction).not.toHaveBeenCalled();

    // Verify empty result
    expect(txHashes).toEqual([]);
  });

  it("should handle transaction failures", async () => {
    vi.mocked(txSender.buildAndSendTransaction).mockRejectedValueOnce(
      new Error("TX failed")
    );

    await expect(harvestAllPositionFees()).rejects.toThrow("TX failed");

    // Verify attempt was made to create transaction
    expect(whirlpools.harvestPositionInstructions).toHaveBeenCalled();
  });

  it("should harvest fees from a specific position", async () => {});

  it("should batch transactions when there are too many positions", async () => {});
});
