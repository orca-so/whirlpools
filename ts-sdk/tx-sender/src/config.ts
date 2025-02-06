let globalConfig: {
  rpcUrl?: string;
  isTriton?: boolean;
  transactionConfig?: TransactionConfig;
} = {};

/**
 * Initializes the global configuration for transaction sending.
 * Calling this allows you to avoid passing the same parameters to every function.
 *
 * @param {Object} config - The configuration object
 * @param {string} config.rpcUrl - The RPC endpoint URL to use for Solana network connections
 * @param {TransactionConfig} [config.transactionConfig] - Optional configuration for transaction priority fees and Jito tips
 * @param {boolean} [config.isTriton] - Optional flag indicating if using Triton infrastructure
 *
 * The TransactionConfig object has the following properties:
 * @param {Object} transactionConfig.priorityFee - Configuration for priority fees
 * @param {"exact" | "dynamic"} transactionConfig.priorityFee.type - Type of priority fee:
 *   - "exact": Use a fixed amount specified by amountLamports
 *   - "dynamic": Calculate fee based on recent fees, optionally capped by maxCapLamports
 * @param {bigint} [transactionConfig.priorityFee.amountLamports] - Fixed amount in lamports for "exact" type
 * @param {bigint} [transactionConfig.priorityFee.maxCapLamports] - Maximum fee cap in lamports for "dynamic" type
 *
 * @param {Object} transactionConfig.jito - Configuration for Jito MEV tips
 * @param {"exact" | "dynamic"} transactionConfig.jito.type - Type of Jito tip:
 *   - "exact": Use a fixed amount specified by amountLamports
 *   - "dynamic": Calculate tip based on recent tips
 * @param {bigint} [transactionConfig.jito.amountLamports] - Fixed amount in lamports for "exact" type
 * @param {bigint} [transactionConfig.jito.maxCapLamports] - Maximum tip cap in lamports for "dynamic" type
 *
 * @param {"solana"} transactionConfig.chainId - Chain identifier, currently only "solana" supported
 *
 * @example
 * init({
 *   rpcUrl: "https://api.mainnet-beta.solana.com",
 *   transactionConfig: {
 *     priorityFee: {
 *       type: "dynamic",
 *       maxCapLamports: 5_000_000 // Cap at 0.005 SOL
 *     },
 *     jito: {
 *       type: "exact",
 *       amountLamports: 1_000_000 // Fixed 0.001 SOL tip
 *     },
 *     chainId: "solana"
 *   },
 *   isTriton: false
 * });
 */
const init = (config: {
  rpcUrl: string;
  transactionConfig?: TransactionConfig;
  isTriton?: boolean;
}) => {
  setGlobalConfig(config);
};

const DEFAULT_PRIORITIZATION: TransactionConfig = {
  priorityFee: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  jito: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  chainId: "solana",
};

const getConnectionContext = (
  rpcUrl?: string,
  isTriton?: boolean
): ConnectionContext => {
  if (rpcUrl) {
    return { rpcUrl, isTriton: !!isTriton };
  }
  if (!globalConfig.rpcUrl) {
    throw new Error(
      "Connection not initialized. Call init() first or provide connection parameter"
    );
  }
  return {
    rpcUrl: globalConfig.rpcUrl,
    isTriton: !!globalConfig.isTriton,
  };
};

const getPriorityConfig = (
  transactionConfig?: TransactionConfig
): TransactionConfig => {
  if (transactionConfig) {
    return transactionConfig;
  }
  if (!globalConfig.transactionConfig) {
    return DEFAULT_PRIORITIZATION;
  }
  return globalConfig.transactionConfig;
};

const setGlobalConfig = (config: {
  rpcUrl: string;
  transactionConfig?: TransactionConfig;
  isTriton?: boolean;
}) => {
  globalConfig = {
    rpcUrl: config.rpcUrl,
    isTriton: !!config.isTriton,
    transactionConfig: config.transactionConfig || DEFAULT_PRIORITIZATION,
  };
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
  chainId: ChainId;
};

type ChainId = "solana" | "eclipse";

type ConnectionContext = { rpcUrl: string; isTriton: boolean };

export {
  init,
  DEFAULT_PRIORITIZATION,
  getPriorityConfig,
  getConnectionContext,
  type ConnectionContext,
  type TransactionConfig,
};
