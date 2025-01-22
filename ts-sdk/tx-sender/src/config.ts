import { Connection } from "@solana/web3.js";
import { DEFAULT_PRIORITIZATION } from "./functions";
import { TransactionConfig } from "./types";

let globalConfig: {
  connection?: Connection;
  isTriton?: boolean;
  transactionConfig?: TransactionConfig;
} = {};

export const getConnection = (
  connectionOrRpcUrl?: Connection | string,
  isTriton?: boolean
): { connection: Connection; isTriton: boolean } => {
  if (connectionOrRpcUrl) {
    return { connection: connection(connectionOrRpcUrl), isTriton: !!isTriton };
  }
  if (!globalConfig.connection) {
    throw new Error(
      "Connection not initialized. Call init() first or provide connection parameter"
    );
  }
  return {
    connection: globalConfig.connection,
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
  connection: Connection;
  transactionConfig?: TransactionConfig;
  isTriton?: boolean;
}) => {
  globalConfig = {
    connection: config.connection,
    isTriton: !!config.isTriton,
    transactionConfig: config.transactionConfig || DEFAULT_PRIORITIZATION,
  };
};

const connection = (connectionOrRpcUrl: Connection | string) => {
  return connectionOrRpcUrl instanceof Connection
    ? connectionOrRpcUrl
    : new Connection(connectionOrRpcUrl);
};
