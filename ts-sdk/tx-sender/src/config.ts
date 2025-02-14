let globalConfig: {
  connectionContext?: ConnectionContext;
  transactionConfig?: TransactionConfig;
} = {};

const DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER = 1.1;
const DEFAULT_PRIORITIZATION: TransactionConfig = {
  priorityFee: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  jito: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  computeUnitMarginMultiplier: DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  priorityFeePercentile: 50,
};

const getConnectionContext = (): ConnectionContext => {
  const connectionContext = globalConfig.connectionContext;
  if (!connectionContext?.rpcUrl) {
    throw new Error(
      "Connection not initialized. Call init() first or provide connection parameter"
    );
  }
  return connectionContext;
};

const getPriorityConfig = (): TransactionConfig => {
  if (!globalConfig.transactionConfig) {
    return DEFAULT_PRIORITIZATION;
  }
  return globalConfig.transactionConfig;
};

const setGlobalConfig = (config: {
  transactionConfig?: TransactionConfig;
  connectionContext?: ConnectionContext;
}) => {
  globalConfig = {
    transactionConfig: config.transactionConfig || DEFAULT_PRIORITIZATION,
    connectionContext: config.connectionContext,
  };
};

const setRpc = (
  url: string,
  chainId: ChainId = "solana",
  supportsPriorityFeePercentile: boolean = false
) => {
  setGlobalConfig({
    ...globalConfig,
    connectionContext: {
      rpcUrl: url,
      supportsPriorityFeePercentile,
      chainId,
    },
  });
};

const setPriorityFeeSetting = (priorityFee: FeeSetting) => {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      priorityFee,
    },
  });
};

const setJitoTipSetting = (jito: FeeSetting) => {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      jito,
    },
  });
};

const setComputeUnitMarginMultiplier = (multiplier: number) => {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      computeUnitMarginMultiplier: multiplier,
    },
  });
};

const setPriorityFeePercentile = (percentile: number) => {
  if (percentile < 0 || percentile > 100) {
    throw new Error("Percentile must be between 0 and 100");
  }
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      priorityFeePercentile: percentile,
    },
  });
};

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

type TransactionConfig = {
  jito: FeeSetting;
  priorityFee: FeeSetting;
  computeUnitMarginMultiplier: number;
  priorityFeePercentile: number;
};

type ChainId = "solana" | "eclipse";

type ConnectionContext = {
  rpcUrl: string;
  supportsPriorityFeePercentile: boolean;
  chainId: ChainId;
};

export {
  setPriorityFeePercentile,
  setPriorityFeeSetting,
  setJitoTipSetting,
  setComputeUnitMarginMultiplier,
  setRpc,
  DEFAULT_PRIORITIZATION,
  DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  getPriorityConfig,
  getConnectionContext,
  type ConnectionContext,
  type TransactionConfig,
  type FeeSetting,
};
