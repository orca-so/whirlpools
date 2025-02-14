import { describe, expect, it, beforeEach } from "vitest";
import {
  buildAndSendTransaction,
  sendSignedTransaction,
} from "../src/sendTransaction";
import { vi } from "vitest";
import * as compatibility from "../src/compatibility";
import * as jito from "../src/jito";
import {
  generateKeyPairSigner,
  IInstruction,
  ITransactionMessageWithFeePayerSigner,
  Rpc,
  SolanaRpcApi,
  TransactionMessageBytes,
} from "@solana/web3.js";
import { getTransferSolInstruction } from "@solana-program/system";
import { address } from "@solana/web3.js";
import {
  setRpc,
  setPriorityFeeSetting,
  setJitoTipSetting,
  setComputeUnitMarginMultiplier,
} from "../src/config";
import { encodeTransaction } from "./utils";
import { buildTransaction } from "../src/buildTransaction";

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual("@solana/web3.js");
  return {
    ...actual,
    signTransactionMessageWithSigners: vi.fn().mockImplementation(
      (
        message: ITransactionMessageWithFeePayerSigner & {
          instructions: IInstruction[];
          version: 0;
        }
      ) => encodeTransaction(message.instructions, message.feePayer)
    ),
    getComputeUnitEstimateForTransactionMessageFactory: vi
      .fn()
      .mockReturnValue(vi.fn().mockResolvedValue(50_000)),
  };
});

const rpcUrl = "https://api.mainnet-beta.solana.com";

const mockRpc = {
  getLatestBlockhash: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({
      value: {
        blockhash: "123456789abcdef",
        lastValidBlockHeight: 123456789,
      },
    }),
  }),
  sendTransaction: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(""),
  }),
  getRecentPrioritizationFees: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue([
      {
        prioritizationFee: BigInt(1000),
        slot: 123456789n,
      },
    ]),
  }),
} as const satisfies Partial<Rpc<SolanaRpcApi>>;

vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(
  mockRpc as unknown as Rpc<SolanaRpcApi>
);

vi.spyOn(jito, "recentJitoTip").mockResolvedValue(BigInt(1000));

describe("Send Transaction", async () => {
  const signer = await generateKeyPairSigner();
  const recipient = address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E");
  const amount = 1_000_000n;

  setRpc(rpcUrl, "solana", false);
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
  });

  it("Should send signed transaction without websocket url", async () => {
    const tx = await buildTransaction([transferInstruction], signer);
    const signature = await sendSignedTransaction(tx);
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
    expect(signature).toBeDefined();
  });

  it("Should handle RPC errors gracefully", async () => {
    const errorMockRpc = {
      ...mockRpc,
      sendTransaction: vi.fn().mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("RPC Error")),
      }),
    };

    vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(
      errorMockRpc as unknown as Rpc<SolanaRpcApi>
    );

    await expect(
      buildAndSendTransaction([transferInstruction], signer)
    ).rejects.toThrow("RPC Error");
  });

  it("Should reject invalid transaction", async () => {
    const tx = await buildTransaction([transferInstruction], signer);

    const invalidTx = {
      ...tx,
      messageBytes: Object.create(
        new Uint8Array([1, 2, 3])
      ) as TransactionMessageBytes,
      signatures: {},
      lifetimeConstraint: tx.lifetimeConstraint,
    };

    await expect(sendSignedTransaction(invalidTx)).rejects.toThrow();
  });
});
