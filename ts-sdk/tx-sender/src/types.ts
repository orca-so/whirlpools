type FeeSetting =
  | {
      type: "dynamic";
      maxCapLamports?: number;
    }
  | {
      type: "exact";
      amountLamports: number;
    }
  | {
      type: "none";
    };

export type TransactionConfig = {
  jito: FeeSetting;
  priorityFee: FeeSetting;
  chainId: ChainId;
};

type ChainId = "solana" | "eclipse";
