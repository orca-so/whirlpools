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

export * from "./price-module";

export type GetPricesConfig = {
  // The first token must be the token that is being priced against the other tokens
  // The subsequent tokens are alternative tokens that can be used to price the first token
  // Tokens must be in base58
  quoteTokens: PublicKey[];
  tickSpacings: number[];
  programId: PublicKey;
  whirlpoolsConfig: PublicKey;
};

// Default config for Orca's mainnet deployment.
// Supply your own if you are using a different deployment.
export const defaultQuoteTokens: PublicKey[] = [
  TOKEN_MINTS["USDC"],
  TOKEN_MINTS["SOL"],
  TOKEN_MINTS["mSOL"],
  TOKEN_MINTS["stSOL"],
].map((mint) => new PublicKey(mint));

export const defaultConfig: GetPricesConfig = {
  quoteTokens: defaultQuoteTokens,
  tickSpacings: ORCA_SUPPORTED_TICK_SPACINGS,
  programId: ORCA_WHIRLPOOL_PROGRAM_ID,
  whirlpoolsConfig: ORCA_WHIRLPOOLS_CONFIG,
};

export type ThresholdConfig = {
  amountOut: u64;
  priceImpactThreshold: number;
};

export const defaultThresholdConfig: ThresholdConfig = {
  amountOut: new u64(1_000_000_000),
  priceImpactThreshold: 1.05,
};

export type PriceCalculationData = {
  poolMap: PoolMap;
  tickArrayMap: TickArrayMap;
  decimalsMap: DecimalsMap;
};

export type PoolMap = Record<string, WhirlpoolData>;
export type TickArrayMap = Record<string, TickArrayData>;
export type PriceMap = Record<string, Decimal | null>;
export type PoolObject = { pool: WhirlpoolData; address: PublicKey };
export type DecimalsMap = Record<string, number>;
