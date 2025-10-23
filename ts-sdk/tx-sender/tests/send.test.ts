import { describe, expect, it, beforeEach } from "vitest";
import {
  buildAndSendTransaction,
  sendTransaction,
} from "../src/sendTransaction";
import { vi } from "vitest";
import * as compatibility from "../src/compatibility";
import * as jito from "../src/jito";
import type {
  Instruction,
  TransactionMessageWithFeePayerSigner,
  Rpc,
  SolanaRpcApi,
  TransactionMessageBytes,
} from "@solana/kit";
import { generateKeyPairSigner } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { address } from "@solana/kit";
import {
  setRpc,
  setPriorityFeeSetting,
  setJitoTipSetting,
  setComputeUnitMarginMultiplier,
} from "../src/config";
import { encodeTransaction } from "./utils";
import { buildTransaction } from "../src/buildTransaction";
import { setupMockRpc, createErrorMockRpc, mockRpc } from "./utils/mockRpc";

vi.mock("@solana/kit", async () => {
  const actual = await vi.importActual("@solana/kit");
  return {
    ...actual,
    partiallySignTransactionMessageWithSigners: vi.fn().mockImplementation(
      (
        message: TransactionMessageWithFeePayerSigner & {
          instructions: Instruction[];
          version: 0;
        },
      ) => encodeTransaction(message.instructions, message.feePayer),
    ),
    getComputeUnitEstimateForTransactionMessageFactory: vi
      .fn()
      .mockReturnValue(vi.fn().mockResolvedValue(50_000)),
  };
});

setupMockRpc();

const rpcUrl = "https://api.mainnet-beta.solana.com";

vi.spyOn(jito, "recentJitoTip").mockResolvedValue(BigInt(1000));

describe("Send Transaction", async () => {
  const signer = await generateKeyPairSigner();
  const recipient = address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E");
  const amount = 1_000_000n;

  const _rpc = await setRpc(rpcUrl); // testing that returning the rpc works
  setPriorityFeeSetting({ type: "none" });
  setJitoTipSetting({ type: "none" });
  setComputeUnitMarginMultiplier(1.05);

  const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: recipient,
    amount,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default mock before each test
    setupMockRpc();
  });

  it("Should send signed transaction without websocket url", async () => {
    const tx = await buildTransaction([transferInstruction], signer);
    const signature = await sendTransaction(tx);
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
    expect(signature).toBeDefined();
  });

  it("Should handle RPC errors gracefully", async () => {
    const errorMockRpc = createErrorMockRpc();
    vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(
      errorMockRpc as unknown as Rpc<SolanaRpcApi>,
    );
    await expect(
      buildAndSendTransaction([transferInstruction], signer),
    ).rejects.toThrow(
      'Transaction simulation failed: {"InstructionError":[0,{"Custom":1}]}',
    );
  });

  it("Should reject invalid transaction", async () => {
    const tx = await buildTransaction([transferInstruction], signer);

    const invalidTx = {
      ...tx,
      messageBytes: Object.create(
        new Uint8Array([1, 2, 3]),
      ) as TransactionMessageBytes,
      signatures: {},
      lifetimeConstraint: tx.lifetimeConstraint,
    };

    await expect(sendTransaction(invalidTx)).rejects.toThrow();
  });
});
