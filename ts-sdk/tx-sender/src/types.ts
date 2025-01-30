import { MicroLamports, Slot } from "@solana/web3.js";
export { PublicKey } from "@solana/web3.js/src/publickey";

type FeeSetting =
  | {
      type: "dynamic";
      maxCapLamports?: bigint;
    }
  | {
      type: "exact";
      amountLamports: bigint;
    }
  | {
      type: "none";
    };

export type TransactionConfig = {
  jito: FeeSetting;
  priorityFee: FeeSetting;
  chainId: ChainId;
};

export type ConnectionContext = { rpcUrl: string; isTriton: boolean };

type ChainId = "solana" | "eclipse";

export type RecentPrioritizationFee = {
  /**
   * The per-compute-unit fee paid by at least one successfully
   * landed transaction, specified in increments of
   * micro-lamports (0.000001 lamports).
   */
  prioritizationFee: MicroLamports;
  /** Slot in which the fee was observed */
  slot: Slot;
};
