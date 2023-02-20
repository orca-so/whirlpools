import { u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  ORCA_SUPPORTED_TICK_SPACINGS,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  TickArrayData,
  TOKEN_MINTS,
  WhirlpoolData,
} from "../types/public";

export * from "./fetchPoolPrices";
export * from "./calculatePoolPrices";

export type GetPricesConfig = {
  // The first token must be the token that is being priced against the other tokens
  // The subsequent tokens are alternative tokens that can be used to price the first token
  // Tokens must be in base58
  quoteTokens: string[];
  tickSpacings: number[];
  programId: PublicKey;
  whirlpoolsConfig: PublicKey;
};

// Default config for Orca's mainnet deployment.
// Supply your own if you are using a different deployment.
export const defaultQuoteTokens: string[] = [TOKEN_MINTS["USDC"], TOKEN_MINTS["SOL"]];
export const defaultConfig: GetPricesConfig = {
  quoteTokens: defaultQuoteTokens,
  tickSpacings: ORCA_SUPPORTED_TICK_SPACINGS,
  programId: ORCA_WHIRLPOOL_PROGRAM_ID,
  whirlpoolsConfig: ORCA_WHIRLPOOLS_CONFIG,
};

export type ThresholdConfig = {
  amountThreshold: u64;
  priceImpactThreshold: number;
};

export const defaultThresholdConfig: ThresholdConfig = {
  amountThreshold: new u64(1_000_000_000),
  priceImpactThreshold: 1.05,
};

export type PoolMap = Record<string, WhirlpoolData>;
export type TickArrayMap = Record<string, TickArrayData>;
export type PriceMap = Record<string, Decimal | null>;
export type TickSpacingAccumulator = { pool: WhirlpoolData; address: PublicKey };
export type DecimalsMap = Record<string, number>;
