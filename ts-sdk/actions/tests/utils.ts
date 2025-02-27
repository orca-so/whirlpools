import { vi } from "vitest";
import type { Address, Rpc, SolanaRpcApi } from "@solana/web3.js";
import { createNoopSigner } from "@solana/web3.js";

// Mock keypair signer for testing
export const mockKeyPairSigner = {
  address: "keypairAddress123" as Address,
  signTransactions: vi.fn(),
  signMessages: vi.fn(),
};

// Mock RPC responses
export const mockRpc = {
  getLatestBlockhash: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({
      value: {
        blockhash: "123456789abcdef",
        lastValidBlockHeight: 123456789,
      },
    }),
  }),
  getMinimumBalanceForRentExemption: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(1000000),
  }),
  getAccount: vi.fn().mockReturnValue({
    send: vi.fn(),
  }),
  getMultipleAccounts: vi.fn().mockReturnValue({
    send: vi.fn(),
  }),
  getProgramAccounts: vi.fn().mockReturnValue({
    send: vi.fn(),
  }),
  getEpochInfo: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({ epoch: 123 }),
  }),
} as unknown as Rpc<SolanaRpcApi>;

// Mock wallet with fixed address
export const mockWallet = createNoopSigner("walletAddress123" as Address);

// Mock position data
export const mockPositions = [
  {
    address: "position1Address" as Address,
    data: {
      positionMint: "positionMint1Address" as Address,
      liquidity: 10000n,
      tickLowerIndex: -100,
      tickUpperIndex: 100,
    },
  },
  {
    address: "position2Address" as Address,
    data: {
      positionMint: "positionMint2Address" as Address,
      liquidity: 20000n,
      tickLowerIndex: -200,
      tickUpperIndex: 200,
    },
  },
];

// Mock pool data
export const mockPools = [
  {
    address: "pool1Address" as Address,
    initialized: true,
    liquidity: 100000n,
    tokenMintA: "tokenA" as Address,
    tokenMintB: "tokenB" as Address,
    price: 1.5,
    tickSpacing: 64,
  },
  {
    address: "pool2Address" as Address,
    initialized: true,
    liquidity: 50000n,
    tokenMintA: "tokenA" as Address,
    tokenMintB: "tokenB" as Address,
    price: 1.55,
    tickSpacing: 128,
  },
  {
    address: "uninitializedPoolAddress" as Address,
    initialized: false,
    liquidity: 0n,
    tokenMintA: "tokenA" as Address,
    tokenMintB: "tokenB" as Address,
    tickSpacing: 64,
  },
];

// Mock swap quote
export const mockSwapQuote = {
  tokenIn: 1000000n,
  tokenEstOut: 1430000n,
  tokenMinOut: 1400000n,
  tradeFee: 1000n,
};

// Mock swap instructions
export const mockSwapInstructions = [
  {
    programAddress: "swapProgramAddress" as Address,
    accounts: [],
    data: new Uint8Array([1, 2, 3]),
  },
  {
    programAddress: "tokenProgramAddress" as Address,
    accounts: [],
    data: new Uint8Array([4, 5, 6]),
  },
];

// Mock harvest instructions
export const mockHarvestInstructions = [
  {
    programAddress: "whirlpoolProgramAddress" as Address,
    accounts: [],
    data: new Uint8Array([7, 8, 9]),
  },
];

// Mock transaction hash
export const mockTxHash = "transaction123hash456";

// Helper to mock successful transaction
export const mockSuccessfulTransaction = () => {
  return Promise.resolve("txHash123");
};

// Helper to mock failed transaction
export const mockFailedTransaction = () => {
  return Promise.reject(new Error("Transaction failed"));
};
