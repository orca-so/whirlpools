import { rpcFromUrl } from "./compatibility";

let globalConfig: {
  connectionContext?: ConnectionContext;
  transactionConfig?: TransactionConfig;
} = {};

export const DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER = 1.1;
export const DEFAULT_PRIORITIZATION: TransactionConfig = {
  priorityFee: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  jito: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  computeUnitMarginMultiplier: DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  priorityFeePercentile: "50",
};

export const getConnectionContext = (): ConnectionContext => {
  const connectionContext = globalConfig.connectionContext;
  if (!connectionContext?.rpcUrl) {
    throw new Error(
      "Connection not initialized. Call init() first or provide connection parameter"
    );
  }
  return connectionContext;
};

export const getPriorityConfig = (): TransactionConfig => {
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

export async function setRpc(
  url: string,
  supportsPriorityFeePercentile: boolean = false,
  chain?: ChainId
) {
  const rpc = rpcFromUrl(url);
  let chainId = chain;

  if (!chainId) {
    chainId = await getChainIdFromGenesisHash(rpc);
  }

  setGlobalConfig({
    ...globalConfig,
    connectionContext: {
      rpcUrl: url,
      supportsPriorityFeePercentile,
      chainId,
    },
  });
}

export async function getChainIdFromGenesisHash(rpc: any): Promise<ChainId> {
  // not all rpc endpoints support getGenesisHash
  try {
    const genesisHash = await rpc.getGenesisHash().send();
    const genesisHashToChainId: Record<string, ChainId> = {
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "solana",
      EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s: "eclipse",
      EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "solana-devnet",
    };
    return genesisHashToChainId[genesisHash] || "unknown";
  } catch (error) {
    return "unknown";
  }
}

export function setPriorityFeeSetting(priorityFee: FeeSetting) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      priorityFee,
    },
  });
}

export function setJitoTipSetting(jito: FeeSetting) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      jito,
    },
  });
}

export function setComputeUnitMarginMultiplier(multiplier: number) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      computeUnitMarginMultiplier: multiplier,
    },
  });
}

export function setPriorityFeePercentile(percentile: Percentile) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      priorityFeePercentile: percentile,
    },
  });
}

export type FeeSetting =
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
  computeUnitMarginMultiplier: number;
  priorityFeePercentile: Percentile;
};

export type Percentile = "25" | "50" | "50ema" | "75" | "95" | "99";
export type ChainId = "solana" | "eclipse" | "solana-devnet" | "unknown";

export type ConnectionContext = {
  rpcUrl: string;
  supportsPriorityFeePercentile: boolean;
  chainId: ChainId;
};
