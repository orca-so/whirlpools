import { describe, expect, it, beforeEach } from "vitest";
import {
  buildAndSendTransaction,
  sendTransaction,
} from "../src/sendTransaction";
import { vi } from "vitest";
import * as compatibility from "../src/compatibility";
import * as jito from "../src/jito";
import type {
  IInstruction,
  ITransactionMessageWithFeePayerSigner,
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

vi.mock("@solana/kit", async () => {
  const actual = await vi.importActual("@solana/kit");
  return {
    ...actual,
    signTransactionMessageWithSigners: vi.fn().mockImplementation(
      (
        message: ITransactionMessageWithFeePayerSigner & {
          instructions: IInstruction[];
          version: 0;
        },
      ) => encodeTransaction(message.instructions, message.feePayer),
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
    send: vi.fn().mockResolvedValue({
      value: {
        signature: "mock_transaction_signature",
      },
    }),
  }),
  getRecentPrioritizationFees: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue([
      {
        prioritizationFee: BigInt(1000),
        slot: 123456789n,
      },
    ]),
  }),
  simulateTransaction: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({
      value: {
        err: null,
      },
    }),
  }),
  getSignatureStatuses: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({
      value: [
        {
          slot: 123456789n,
          confirmations: 1,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    }),
  }),
} as const satisfies Partial<Rpc<SolanaRpcApi>>;

vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(
  mockRpc as unknown as Rpc<SolanaRpcApi>,
);

vi.spyOn(jito, "recentJitoTip").mockResolvedValue(BigInt(1000));

describe("Send Transaction", async () => {
  const signer = await generateKeyPairSigner();
  const recipient = address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E");
  const amount = 1_000_000n;

  await setRpc(rpcUrl, false);
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
    const signature = await sendTransaction(tx);
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
    expect(signature).toBeDefined();
  });

  it("Should handle RPC errors gracefully", async () => {
    const errorMockRpc = {
      ...mockRpc,
      simulateTransaction: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          value: {
            err: { InstructionError: [0, { Custom: 1 }] },
          },
        }),
      }),
      sendTransaction: vi.fn().mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("RPC Error")),
      }),
      getSignatureStatuses: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          value: [null],
        }),
      }),
    };
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
