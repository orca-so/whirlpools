import { u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  ORCA_SUPPORTED_TICK_SPACINGS,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  TickArrayData,
  WhirlpoolData
} from "../types/public";
import { TOKEN_MINTS } from "../utils/constants";

export * from "./price-module";

/**
 * A config object for the {@link PriceModule} functions.
 *
 * @category PriceModule
 * @param quoteTokens The group of quote tokens that you want to search Whirlpools for.
 *                    The first token must be the token that is being priced against the other tokens.
 *                    The subsequent tokens are alternative tokens that can be used to price the first token.
 * @param tickSpacings The group of tick spacings that you want to search Whirlpools for.
 * @param programId The public key of the Whirlpool Program account that you want to search Whirlpools for.
 * @param whirlpoolsConfig The public key of the {@link WhirlpoolsConfig} account that you want to search Whirlpools for.
 */
export type GetPricesConfig = {
  quoteTokens: PublicKey[];
  tickSpacings: number[];
  programId: PublicKey;
  whirlpoolsConfig: PublicKey;
};

/**
 * A config object for the {@link PriceModule} functions to define thresholds for price calculations.
 * Whirlpools that do not fit the criteria set by the parameters below will be excluded in the price calculation.
 *
 * @category PriceModule
 * @param amountOut The token amount in terms of the first quote token amount to evaluate a Whirlpool's liquidity against.
 * @param priceImpactThreshold Using amountOut to perform a swap quote on a pool, this value is the maximum price impact
 *                             that a Whirlpool can have to be included in the price calculation.
 */
export type GetPricesThresholdConfig = {
  amountOut: u64;
  priceImpactThreshold: number;
};

/**
 * A set of fetched accounts that are used for price calculations in {@link PriceModule} functions.
 *
 * @category PriceModule
 * @param poolMap A map of {@link WhirlpoolData} accounts that are used for price calculations.
 * @param tickArrayMap A map of {@link TickArrayData} accounts that are used for price calculations.
 * @param decimalsMap A map of token decimals that are used for price calculations.
 */
export type PriceCalculationData = {
  poolMap: PoolMap;
  tickArrayMap: TickArrayMap;
  decimalsMap: DecimalsMap;
};

/**
 * A map of whirlpool addresses against {@link WhirlpoolData} accounts
 * @category PriceModule
 */
export type PoolMap = Record<string, WhirlpoolData>;

/**
 * A map of tick-array addresses against {@link TickArrayData} accounts
 * @category PriceModule
 */
export type TickArrayMap = Record<string, TickArrayData>;

/**
 * A map of token mint addresses against price values. If a price is not available, the value will be null.
 * @category PriceModule
 */
export type PriceMap = Record<string, Decimal | null>;

/**
 * A map of token mint addresses against token decimals.
 * @category PriceModule
 */
export type DecimalsMap = Record<string, number>;

/**
 * The default quote tokens used for Orca's mainnet deployment.
 * Supply your own if you are using a different deployment.
 * @category PriceModule
 */
export const defaultQuoteTokens: PublicKey[] = [
  TOKEN_MINTS["USDC"],
  TOKEN_MINTS["SOL"],
  TOKEN_MINTS["mSOL"],
  TOKEN_MINTS["stSOL"],
].map((mint) => new PublicKey(mint));

/**
 * The default {@link GetPricesConfig} config for Orca's mainnet deployment.
 * @category PriceModule
 */
export const defaultGetPricesConfig: GetPricesConfig = {
  quoteTokens: defaultQuoteTokens,
  tickSpacings: ORCA_SUPPORTED_TICK_SPACINGS,
  programId: ORCA_WHIRLPOOL_PROGRAM_ID,
  whirlpoolsConfig: ORCA_WHIRLPOOLS_CONFIG,
};

/**
 * The default {@link GetPricesThresholdConfig} config for Orca's mainnet deployment.
 * @category PriceModule
 */
export const defaultGetPricesThresholdConfig: GetPricesThresholdConfig = {
  amountOut: new u64(1_000_000_000),
  priceImpactThreshold: 1.05,
};
