import type { Rpc, SolanaRpcApi } from "@solana/kit";
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
  jitoBlockEngineUrl: "https://bundles.jito.wtf",
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

/**
 * Retrieves the current Jito block engine URL.
 *
 * @returns {string} The Jito block engine URL.
 */
export const getJitoBlockEngineUrl = (): string => {
  return getPriorityConfig().jitoBlockEngineUrl;
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
 * Initializes the global RPC configuration and returns an RPC instance.
 *
 * @param {string} url - The Solana RPC endpoint URL.
 * @param {object} [options] - Optional RPC configuration
 * @param {boolean} [options.supportsPriorityFeePercentile=false] - Whether the RPC supports percentile-based priority fees. Set this to true if the RPC provider is Triton.
 * @param {number} [options.pollIntervalMs=0] - Milliseconds between confirmation status checks. Set to 0 for continuous polling (default).
 * @param {boolean} [options.resendOnPoll=true] - Whether to resend the transaction on each poll attempt (default: true).
 * @returns {Promise<Rpc<SolanaRpcApi>>} A Promise that resolves to an RPC instance configured for the specified endpoint.
 *
 * @example
 * ```ts
 * // Premium RPC: Use defaults for maximum landing rate
 * const rpc = await setRpc("https://mainnet.helius-rpc.com/?api-key=...");
 *
 * // Lower tier RPCs: Configure to reduce RPC usage
 * const rpc = await setRpc("https://api.devnet.solana.com", {
 *   pollIntervalMs: 1000,
 *   resendOnPoll: false,
 * });
 * ```
 */
export async function setRpc(
  url: string,
  options: {
    supportsPriorityFeePercentile?: boolean;
    pollIntervalMs?: number;
    resendOnPoll?: boolean;
  } = {},
): Promise<Rpc<SolanaRpcApi>> {
  const rpc = rpcFromUrl(url);
  const chainId = await getChainIdFromGenesisHash(rpc);

  setGlobalConfig({
    ...globalConfig,
    rpcConfig: {
      rpcUrl: url,
      supportsPriorityFeePercentile:
        options.supportsPriorityFeePercentile ?? false,
      chainId,
      pollIntervalMs: options.pollIntervalMs ?? 0,
      resendOnPoll: options.resendOnPoll ?? true,
    },
  });

  // Create a wrapper Proxy that makes the RPC non-thenable
  // This prevents the RPC's .then from interfering with Promise resolution
  const nonThenableRpc = new Proxy(rpc, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return undefined; // Make it non-thenable
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return nonThenableRpc;
}

async function getChainIdFromGenesisHash(
  rpc: Rpc<SolanaRpcApi>,
): Promise<ChainId> {
  // not all rpc endpoints support getGenesisHash
  try {
    const genesisHash = await rpc.getGenesisHash().send();
    const genesisHashToChainId: Record<string, ChainId> = {
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "solana",
      EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s: "eclipse",
      EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "solana-devnet",
      CX4huckiV9QNAkKNVKi5Tj8nxzBive5kQimd94viMKsU: "eclipse-testnet",
    };
    return genesisHashToChainId[genesisHash] || "unknown";
  } catch (error) {
    console.warn("Error getting chain ID from genesis hash", error);
    return "unknown";
  }
}

/**
 * Sets the Jito block engine URL.
 *
 * @param {string} url - The Jito block engine URL.
 */
export async function setJitoBlockEngineUrl(url: string) {
  setGlobalConfig({
    ...globalConfig,
    transactionConfig: {
      ...getPriorityConfig(),
      jitoBlockEngineUrl: url,
    },
  });
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
 * Compute unit limit strategy for transaction building.
 * - `dynamic`: Estimate compute units by simulating the transaction (default).
 * - `exact`: Use a specific compute unit limit without simulation.
 */
export type ComputeUnitLimitStrategy =
  | { type: "dynamic" }
  | { type: "exact"; units: number };

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
  jitoBlockEngineUrl: string;
};

/**
 * Defines a percentile value for priority fee selection.
 */
export type Percentile = "25" | "50" | "75" | "95" | "99";

/**
 * Represents a supported blockchain network chain ID.
 */
export type ChainId =
  | "solana"
  | "eclipse"
  | "solana-devnet"
  | "eclipse-testnet"
  | "unknown";

/**
 * Configuration for RPC settings and transaction sending strategy.
 *
 * The transaction sending strategy should be configured based on your RPC tier:
 * - **Premium RPC** (e.g., Helius, Triton): Can use default aggressive settings with resend enabled
 * - **Public/Free RPC**: Should use conservative settings to avoid rate limits
 *
 * @property {string} rpcUrl - The RPC endpoint URL
 * @property {boolean} supportsPriorityFeePercentile - Whether the RPC supports percentile-based priority fee estimation
 * @property {ChainId} chainId - The blockchain network chain ID
 * @property {number} [pollIntervalMs=0] - Milliseconds between confirmation status checks.
 *   Set to 0 for continuous polling (no delay).
 * @property {boolean} [resendOnPoll=true] - Whether to resend the transaction on each poll attempt.
 *   - `true` (default): Resend transaction on every poll. Higher RPC usage, best for premium RPCs.
 *   - `false`: Send once, then only poll for status. Lower RPC usage, recommended for public RPCs.
 *
 * @example
 * ```ts
 * // Premium RPC: Use defaults for maximum landing rate
 * setRpc("https://mainnet.helius-rpc.com/?api-key=...");
 *
 * // Public/Free RPC: Conservative settings to control RPC usage
 * setRpc("https://api.devnet.solana.com", {
 *   pollIntervalMs: 1000,
 *   resendOnPoll: false,
 * });
 * ```
 */
export type RpcConfig = {
  rpcUrl: string;
  supportsPriorityFeePercentile: boolean;
  chainId: ChainId;
  pollIntervalMs: number;
  resendOnPoll: boolean;
};

/**
 * Configuration for building transactions with explicit settings.
 * Use this with `buildTransactionWithConfig` for full control over transaction building.
 *
 * @property {RpcConfig} rpcConfig - RPC connection settings
 * @property {TransactionConfig} transactionConfig - Fee and compute settings
 * @property {ComputeUnitLimitStrategy} [computeUnitLimitStrategy] - How to determine compute unit limit.
 *   Defaults to `{ type: "dynamic" }` which simulates to estimate compute units.
 *   Use `{ type: "exact", units: N }` to skip simulation and use a specific limit.
 */
export type BuildTransactionConfig = {
  rpcConfig: RpcConfig;
  transactionConfig?: TransactionConfig;
  computeUnitLimitStrategy?: ComputeUnitLimitStrategy;
};
