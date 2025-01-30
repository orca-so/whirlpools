import { DEFAULT_PRIORITIZATION } from "./functions";
import { TransactionConfig, ConnectionContext } from "./types";

let globalConfig: {
  rpcUrl?: string;
  isTriton?: boolean;
  transactionConfig?: TransactionConfig;
} = {};

export const getConnectionContext = (
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

export const getPriorityConfig = (
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

export const setGlobalConfig = (config: {
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
