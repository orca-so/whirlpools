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
import { init } from "../src/config";
import { encodeTransaction } from "./utils";
import { buildTransaction } from "../src/buildTransaction";

vi.mock("@solana/transaction-confirmation", () => ({
  createRecentSignatureConfirmationPromiseFactory: vi.fn(() =>
    vi.fn().mockResolvedValue(undefined)
  ),
  waitForRecentTransactionConfirmationUntilTimeout: vi.fn(),
  getTimeoutPromise: vi.fn().mockResolvedValue(undefined),
}));

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

// Get mocked functions
const {
  createRecentSignatureConfirmationPromiseFactory,
  waitForRecentTransactionConfirmationUntilTimeout,
} = await import("@solana/transaction-confirmation");

describe("Send Transaction", async () => {
  const signer = await generateKeyPairSigner();
  const recipient = address("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E");
  const amount = 1_000_000n;
  init({ connectionContext: { rpcUrl, isTriton: false } });

  const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: recipient,
    amount,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(compatibility, "subscriptionsFromWsUrl").mockReturnValue({
      signatureNotifications: vi.fn(),
      accountNotifications: vi.fn(),
      logsNotifications: vi.fn(),
      programNotifications: vi.fn(),
      rootNotifications: vi.fn(),
      slotNotifications: vi.fn(),
    });
  });

  it("Should send signed transaction without websocket url", async () => {
    const tx = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    const signature = await sendSignedTransaction(tx, rpcUrl);
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
    expect(signature).toBeDefined();
  });

  it("Should send signed transaction with websocket url", async () => {
    const tx = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    const wsUrl = "wss://api.mainnet-beta.solana.com";
    const signature = await sendSignedTransaction(tx, rpcUrl, wsUrl);
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
    expect(createRecentSignatureConfirmationPromiseFactory).toHaveBeenCalled();
    expect(signature).toBeDefined();
  });

  it("Should send basic transaction with no priority fees", async () => {
    await buildAndSendTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });
    expect(jito.recentJitoTip).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
  });

  it("Should send transaction with dynamic priority fee", async () => {
    await buildAndSendTransaction([transferInstruction], signer, {
      priorityFee: {
        type: "dynamic",
        maxCapLamports: 100_000n,
      },
      jito: { type: "none" },
      chainId: "solana",
    });
    expect(jito.recentJitoTip).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
  });

  it("Should send transaction with exact Jito tip", async () => {
    await buildAndSendTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: {
        type: "exact",
        amountLamports: 10_000n,
      },
      chainId: "solana",
    });
    expect(jito.recentJitoTip).not.toHaveBeenCalled();
    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
  });

  it("Should send transaction with dynamic Jito tip", async () => {
    await buildAndSendTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "dynamic" },
      chainId: "solana",
    });

    expect(mockRpc.sendTransaction().send).toHaveBeenCalled();
    expect(jito.recentJitoTip).toHaveBeenCalled();
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
      buildAndSendTransaction([transferInstruction], signer, {
        priorityFee: { type: "none" },
        jito: { type: "none" },
        chainId: "solana",
      })
    ).rejects.toThrow("RPC Error");
  });

  it("Should timeout when confirmation takes too long", async () => {
    const tx = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    const timeoutError = new Error("Timed out waiting for confirmation");
    vi.mocked(
      waitForRecentTransactionConfirmationUntilTimeout
    ).mockRejectedValueOnce(timeoutError);

    const wsUrl = "wss://api.mainnet-beta.solana.com";
    await expect(sendSignedTransaction(tx, rpcUrl, wsUrl)).rejects.toThrow(
      "Timed out waiting for confirmation"
    );
  });

  it("Should reject invalid transaction", async () => {
    const tx = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    const invalidTx = {
      ...tx,
      messageBytes: Object.create(
        new Uint8Array([1, 2, 3])
      ) as TransactionMessageBytes,
      signatures: {},
      lifetimeConstraint: tx.lifetimeConstraint,
    };

    await expect(sendSignedTransaction(invalidTx, rpcUrl)).rejects.toThrow();
  });

  it("Should handle websocket connection failures", async () => {
    const tx = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    vi.spyOn(compatibility, "subscriptionsFromWsUrl").mockImplementation(() => {
      throw new Error("WebSocket connection failed");
    });

    const wsUrl = "wss://api.mainnet-beta.solana.com";
    await expect(sendSignedTransaction(tx, rpcUrl, wsUrl)).rejects.toThrow(
      "WebSocket connection failed"
    );
  });

  it("Should verify transaction confirmation", async () => {
    const tx = await buildTransaction([transferInstruction], signer, {
      priorityFee: { type: "none" },
      jito: { type: "none" },
      chainId: "solana",
    });

    const wsUrl = "wss://api.mainnet-beta.solana.com";
    const signature = await sendSignedTransaction(tx, rpcUrl, wsUrl);
    expect(createRecentSignatureConfirmationPromiseFactory).toHaveBeenCalled();
    expect(signature).toBeDefined();
  });
});
