import { vi } from "vitest";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import * as compatibility from "../../src/compatibility";

export const getLatestBlockhashMockRpcResponse = {
  value: {
    blockhash: "123456789abcdef",
    lastValidBlockHeight: 123456789,
  },
};

export const mockRpcMethods = {
  getLatestBlockhash: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(getLatestBlockhashMockRpcResponse),
  }),
  getRecentPrioritizationFees: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue([
      {
        prioritizationFee: BigInt(1000),
        slot: BigInt(123456789),
      },
    ]),
  }),
  getGenesisHash: vi.fn().mockReturnValue({
    send: vi
      .fn()
      .mockResolvedValue("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"),
  }),
  getSlot: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(BigInt(123456789)),
  }),
  getBlockHeight: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(BigInt(987654321)),
  }),
  sendTransaction: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({
      value: {
        signature: "mock_transaction_signature",
      },
    }),
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
          slot: BigInt(123456789),
          confirmations: 1,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    }),
  }),
} as const satisfies Partial<Rpc<SolanaRpcApi>>;

export const mockRpc = mockRpcMethods;

/**
 * Sets up the mock RPC for tests. Call this in your test setup.
 * @param customMethods Optional custom methods to override defaults
 */
export function setupMockRpc(customMethods?: Partial<typeof mockRpcMethods>) {
  const finalMockRpc = { ...mockRpcMethods, ...customMethods };

  vi.spyOn(compatibility, "rpcFromUrl").mockReturnValue(
    finalMockRpc as unknown as Rpc<SolanaRpcApi>,
  );

  return finalMockRpc;
}

/**
 * Creates a mock RPC with error responses for testing error handling
 */
export function createErrorMockRpc() {
  return {
    ...mockRpcMethods,
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
}
