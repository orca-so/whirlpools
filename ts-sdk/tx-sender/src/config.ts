import { rpcFromUrl } from "./compatibility";

let globalConfig: {
  rpcConfig?: RpcConfig;
  transactionConfig?: TransactionConfig;
} = {};

/**
 * Default compute unit margin multiplier used to ensure sufficient compute budget.
 */
export const DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER = 1.1;

/**
 * Default prioritization settings, including priority fees and Jito tips.
 */
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

/**
 * Retrieves the current RPC configuration.
 *
 * @throws {Error} If the RPC connection has not been initialized using `setRpc()`.
 * @returns {RpcConfig} The RPC configuration including the RPC URL, support for percentile-based fees, and the chain ID.
 */
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

/**
 * Retrieves the current Jito fee settings.
 *
 * @returns {JitoFeeSetting} The Jito fee configuration, including fee type, max cap, and percentile.
 */
export const getJitoConfig = (): JitoFeeSetting => {
  return getPriorityConfig().jito;
};

/**
 * Retrieves the current priority fee configuration.
 *
 * @returns {PriorityFeeSetting} The priority fee settings, which include dynamic, exact or none fee settings and priority fee percentile.
 */
export const getPriorityFeeConfig = (): PriorityFeeSetting => {
  return getPriorityConfig().priorityFee;
};

/**
 * Retrieves the compute unit margin multiplier.
 *
 * @returns {number} The multiplier applied to compute units for transaction execution.
 */
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

/**
 * Initializes the global RPC configuration.
 *
 * @param {string} url - The Solana RPC endpoint URL.
 * @param {boolean} [supportsPriorityFeePercentile=false] - Whether the RPC supports percentile-based priority fees. Set this to true if the RPC provider is Triton.
 * @returns {Promise<void>} Resolves once the configuration has been set.
 *
 * @example
 * ```ts
 * await setRpc("https://api.mainnet-beta.solana.com");
 * ```
 */
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

async function getChainIdFromGenesisHash(rpc: any): Promise<ChainId> {
  // not all rpc endpoints support getGenesisHash
  try {
    const genesisHash = await rpc.getGenesisHash().send();
    const genesisHashToChainId: Record<string, ChainId> = {
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "solana",
      "EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s": "eclipse",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG": "solana-devnet",
      "CX4huckiV9QNAkKNVKi5Tj8nxzBive5kQimd94viMKsU": "eclipse-testnet",
    };
    return genesisHashToChainId[genesisHash] || "unknown";
  } catch (error) {
    return "unknown";
  }
}

/**
 * Updates the priority fee settings.
 *
 * @param {FeeSetting} priorityFee - The new priority fee configuration.
 */
export function setPriorityFeeSetting(priorityFee: FeeSetting) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      priorityFee,
    },
  });
}

/**
 * Updates the Jito tip settings.
 *
 * @param {FeeSetting} jito - The new Jito fee configuration.
 */
export function setJitoTipSetting(jito: FeeSetting) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      jito,
    },
  });
}

/**
 * Updates the compute unit margin multiplier.
 *
 * @param {number} multiplier - The new compute unit margin multiplier.
 */
export function setComputeUnitMarginMultiplier(multiplier: number) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      computeUnitMarginMultiplier: multiplier,
    },
  });
}

/**
 * Sets the percentile used for Jito fee calculations.
 *
 * @param {Percentile | "50ema"} percentile - The new percentile setting for Jito fees. "50ema" is the exponential moving average of the 50th percentile.
 */
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

/**
 * Sets the percentile used for priority fee calculations.
 *
 * @param {Percentile} percentile - The new percentile setting for priority fees.
 */
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

/**
 * Configuration for transaction fees, including Jito and priority fee settings.
 */
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

/**
 * Defines a percentile value for priority fee selection.
 */
export type Percentile = "25" | "50" | "75" | "95" | "99";

/**
 * Represents a supported blockchain network chain ID.
 */
export type ChainId = "solana" | "eclipse" | "solana-devnet" | "eclipse-testnet" | "unknown";

/**
 * Configuration for RPC settings.
 */
export type RpcConfig = {
  rpcUrl: string;
  supportsPriorityFeePercentile: boolean;
  chainId: ChainId;
};
