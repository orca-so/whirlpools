let globalConfig: {
  connectionContext?: ConnectionContext;
  transactionConfig?: TransactionConfig;
} = {};

/**
 * Initializes the global configuration for transaction sending.
 * Calling this allows you to avoid passing the same parameters to every function.
 *
 * @param {Object} config - The configuration object
 * @param {ConnectionContext} [config.connectionContext] - Connection configuration
 * @param {string} config.connectionContext.rpcUrl - The RPC endpoint URL to use for Solana network connections
 * @param {boolean} [config.connectionContext.isTriton] - Optional flag indicating if using Triton infrastructure
 * @param {string} [config.connectionContext.wsUrl] - Optional WebSocket URL for transaction confirmation
 * @param {TransactionConfig} [config.transactionConfig] - Optional configuration for transaction priority fees and Jito tips
 *
 * The TransactionConfig object has the following properties:
 * @param {FeeSetting} transactionConfig.priorityFee - Configuration for priority fees
 * @param {"exact" | "dynamic" | "none"} transactionConfig.priorityFee.type - Type of priority fee:
 *   - "exact": Use a fixed amount specified by amountLamports
 *   - "dynamic": Calculate fee based on recent fees, optionally capped by maxCapLamports
 *   - "none": No priority fee
 * @param {bigint} [transactionConfig.priorityFee.amountLamports] - Fixed amount in lamports for "exact" type
 * @param {bigint} [transactionConfig.priorityFee.maxCapLamports] - Maximum fee cap in lamports for "dynamic" type
 *
 * @param {FeeSetting} transactionConfig.jito - Configuration for Jito MEV tips
 * @param {"exact" | "dynamic" | "none"} transactionConfig.jito.type - Type of Jito tip:
 *   - "exact": Use a fixed amount specified by amountLamports
 *   - "dynamic": Calculate tip based on recent tips
 *   - "none": No Jito tip
 * @param {bigint} [transactionConfig.jito.amountLamports] - Fixed amount in lamports for "exact" type
 * @param {bigint} [transactionConfig.jito.maxCapLamports] - Maximum tip cap in lamports for "dynamic" type
 *
 * @param {ChainId} transactionConfig.chainId - Chain identifier ("solana" or "eclipse")
 * @param {number} [transactionConfig.computeUnitMarginMultiplier] - Optional multiplier for compute unit margin
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
 *     chainId: "solana",
 *     computeUnitMarginMultiplier: 1.04, // 4% margin for compute units
 *   },
 *   isTriton: false
 * });
 */
const init = (config: {
  transactionConfig?: TransactionConfig;
  connectionContext?: ConnectionContext;
}) => {
  setGlobalConfig(config);
};

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
  chainId: "solana",
  computeUnitMarginMultiplier: DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
};
const getConnectionContext = (
  rpcUrl?: string,
  isTriton?: boolean,
  wsUrl?: string
): ConnectionContext => {
  if (rpcUrl) {
    return {
      rpcUrl,
      isTriton: !!isTriton,
      wsUrl:
        wsUrl !== undefined ? wsUrl : globalConfig.connectionContext?.wsUrl,
    };
  }

  const connectionContext = globalConfig.connectionContext;
  if (!connectionContext?.rpcUrl) {
    throw new Error(
      "Connection not initialized. Call init() first or provide connection parameter"
    );
  }

  return {
    rpcUrl: connectionContext.rpcUrl,
    isTriton: !!connectionContext.isTriton,
    wsUrl: connectionContext.wsUrl,
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
  transactionConfig?: TransactionConfig;
  connectionContext?: ConnectionContext;
}) => {
  globalConfig = {
    transactionConfig: config.transactionConfig || DEFAULT_PRIORITIZATION,
    connectionContext: config.connectionContext,
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
  computeUnitMarginMultiplier?: number;
};

type ChainId = "solana" | "eclipse";

type ConnectionContext = { rpcUrl: string; isTriton?: boolean; wsUrl?: string };

export {
  init,
  DEFAULT_PRIORITIZATION,
  DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  getPriorityConfig,
  getConnectionContext,
  type ConnectionContext,
  type TransactionConfig,
};
