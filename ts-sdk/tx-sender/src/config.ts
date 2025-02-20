import { rpcFromUrl } from "./compatibility";

let globalConfig: {
  rpcConfig?: RpcConfig;
  transactionConfig?: TransactionConfig;
} = {};

export const DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER = 1.1;
export const DEFAULT_PRIORITIZATION: TransactionConfig = {
  priorityFee: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
    priorityFeePercentile: "50",
  },
  jito: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
    priorityFeePercentile: "50",
  },
  computeUnitMarginMultiplier: DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
};

export const getRpcConfig = (): RpcConfig => {
  const rpcConfig = globalConfig.rpcConfig;
  if (!rpcConfig?.rpcUrl) {
    throw new Error("Connection not initialized. Call setRpc() first");
  }
  return rpcConfig;
};

const getPriorityConfig = (): TransactionConfig => {
  if (!globalConfig.transactionConfig) {
    return DEFAULT_PRIORITIZATION;
  }
  return globalConfig.transactionConfig;
};

export const getJitoConfig = (): JitoFeeSetting => {
  return getPriorityConfig().jito;
};

export const getPriorityFeeConfig = (): PriorityFeeSetting => {
  return getPriorityConfig().priorityFee;
};

export const getComputeUnitMarginMultiplier = (): number => {
  return getPriorityConfig().computeUnitMarginMultiplier;
};

const setGlobalConfig = (config: {
  transactionConfig?: TransactionConfig;
  rpcConfig?: RpcConfig;
}) => {
  globalConfig = {
    transactionConfig: config.transactionConfig || DEFAULT_PRIORITIZATION,
    rpcConfig: config.rpcConfig,
  };
};

export async function setRpc(
  url: string,
  supportsPriorityFeePercentile: boolean = false,
) {
  const rpc = rpcFromUrl(url);
  const chainId = await getChainIdFromGenesisHash(rpc);

  setGlobalConfig({
    ...globalConfig,
    rpcConfig: {
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

export function setJitoFeePercentile(percentile: Percentile | "50ema") {
  const jito = getPriorityConfig().jito;
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      jito: {
        ...jito,
        priorityFeePercentile: percentile,
      },
    },
  });
}

export function setPriorityFeePercentile(percentile: Percentile) {
  const priorityConfig = getPriorityConfig();
  const priorityFee = priorityConfig.priorityFee;
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...priorityConfig,
      priorityFee: {
        ...priorityFee,
        priorityFeePercentile: percentile,
      },
    },
  });
}

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

export type JitoFeeSetting = FeeSetting & {
  priorityFeePercentile?: Percentile | "50ema";
};

export type PriorityFeeSetting = FeeSetting & {
  priorityFeePercentile?: Percentile;
};

export type TransactionConfig = {
  jito: JitoFeeSetting;
  priorityFee: PriorityFeeSetting;
  computeUnitMarginMultiplier: number;
};

export type Percentile = "25" | "50" | "75" | "95" | "99";
export type ChainId = "solana" | "eclipse" | "solana-devnet" | "unknown";

export type RpcConfig = {
  rpcUrl: string;
  supportsPriorityFeePercentile: boolean;
  chainId: ChainId;
};
