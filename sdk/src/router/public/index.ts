import { Address } from "@coral-xyz/anchor";
import { Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { AddressLookupTableAccount } from "@solana/web3.js";
import BN from "bn.js";
import { WhirlpoolAccountFetchOptions } from "../../network/public/fetcher";
import { SwapQuote } from "../../quotes/public";
import { Path } from "../../utils/public";
import { AtaAccountInfo, RouteSelectOptions } from "./router-utils";

export * from "./router-builder";
export * from "./router-utils";

/**
 * A Trade type that represents a trade between two tokens
 *
 * @category Router
 * @param tokenIn The token that is being traded in
 * @param tokenOut The token that is being traded out
 * @param tradeAmount The amount of token being traded in or out
 * @param amountSpecifiedIsInput Whether the trade amount is the amount being traded in or out
 */
export type Trade = {
  tokenIn: Address;
  tokenOut: Address;
  tradeAmount: BN;
  amountSpecifiedIsInput: boolean;
};

/**
 * Options to configure the router.
 *
 * @category Router
 * @param percentIncrement The percent increment to use when splitting a trade into multiple trades.
 * @param numTopRoutes The number of top routes to return from the router.
 * @param numTopPartialQuotes The number of top partial quotes to return from the router.
 * @param maxSplits The maximum number of splits to perform on a trade.
 */
export type RoutingOptions = {
  percentIncrement: number;
  numTopRoutes: number;
  numTopPartialQuotes: number;
  maxSplits: number;
};

/**
 * A trade route that is ready to execute.
 * A trade can be broken into multiple sub-trades for potentially better trades.
 *
 * @category Router
 * @param subRoutes
 * The sub-routes that make up the trade route. The sum of all splitPercent should equal 100.
 * @param totalAmountIn The total amount of token being traded in for this trade.
 * @param totalAmountOut The total amount of token being traded out for this trade.
 */
export type TradeRoute = {
  subRoutes: SubTradeRoute[];
  totalAmountIn: BN;
  totalAmountOut: BN;
};

/**
 * Represents a fragment of a trade that was splitted into multiple trades for more efficient execution.
 *
 * @category Router
 * @param path The path of pool addresses that make up this sub trade.
 * @param splitPercent The percent of the trade that this sub trade represents.
 * @param amountIn The amount of token being traded in within this sub-route.
 * @param amountOut The amount of token being traded out within this sub-routes.
 * @param hopQuotes The quotes for each hop in the path of this trade.
 */
export type SubTradeRoute = {
  path: Path;
  splitPercent: number;
  amountIn: BN;
  amountOut: BN;
  hopQuotes: TradeHop[];
};

/**
 * Represents a quote for a single hop in the path of a {@link SubTradeRoute}.
 *
 * @category Router
 * @param amountIn The amount of token being traded in for this hop.
 * @param amountOut The amount of token being traded out for this hop.
 * @param whirlpool The address of the whirlpool that this hop is trading through.
 * @param sqrtPrice The square root price of the pool at the time of the trade.
 * @param totalFeeRate The total fee rate of the pool at the time of the trade.
 * @param inputMint The address of the input token mint.
 * @param outputMint The address of the output token mint.
 * @param mintA The address of the first mint in the pool.
 * @param mintB The address of the second mint in the pool.
 * @param vaultA The address of the first vault in the pool.
 * @param vaultB The address of the second vault in the pool.
 * @param quote The {@link SwapQuote} for this hop.
 */
export type TradeHop = {
  amountIn: BN;
  amountOut: BN;
  whirlpool: Address;
  inputMint: Address;
  outputMint: Address;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  quote: SwapQuote;
  snapshot: TradeHopSnapshot;
};

export type TradeHopSnapshot = {
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
  sqrtPrice: BN;
  totalFeeRate: Percentage;
}

/**
 * A trade route that is ready to execute.
 * Contains the {@link TradeRoute} and a possible set of {@link AddressLookupTableAccount} that
 * is needed to successfully execute the trade.
 *
 * If the lookup table accounts are undefined, then the trade can be executed with a legacy transaction.
 *
 * @category Router
 */
export type ExecutableRoute = readonly [TradeRoute, AddressLookupTableAccount[] | undefined];

/**
 * Convienience class to find routes through a set of Whirlpools and execute a swap across them.
 * The router only supports up to 2-hop trades between pools and does not support arbitrage trades
 * between the same token.
 *
 * @category Router
 */
export interface WhirlpoolRouter {
  /**
   * Finds all possible routes for a trade, ordered by the best other token amount you would get from a trade.
   * Use {@link RouterUtils.selectFirstExecutableRoute} to find the best executable route.
   *
   * @param trade
   * The trade to find routes for.
   * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
   * @param opts
   * {@link RoutingOptions} to configure the router. Missing options will be filled with default values from
   * {@link RouterUtils.getDefaultRoutingOptions}.
   * @param fetchOpts
   * {@link WhirlpoolAccountFetchOptions} to configure the fetching of on-chain data.
   * @return A list of {@link TradeRoute} that can be used to execute a swap, ordered by the best other token amount.
   */
  findAllRoutes(
    trade: Trade,
    opts?: Partial<RoutingOptions>,
    fetchOpts?: WhirlpoolAccountFetchOptions
  ): Promise<TradeRoute[]>;

  /**
   * Finds all possible routes for a trade and select the best route that is executable
   * under the current execution environment.
   * @param trade
   * The trade to find routes for.
   * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
   * @param opts
   * {@link RoutingOptions} to configure the router. Missing options will be filled with default values from
   * {@link RouterUtils.getDefaultRoutingOptions}.
   * @param selectionOpts
   * {@link RouteSelectOptions} to configure the selection of the best route. Missing options
   * will be filled with default values from {@link RouterUtils.getDefaultRouteSelectOptions}.
   * @param fetchOpts
   * {@link WhirlpoolAccountFetchOptions} to configure the fetching of on-chain data.
   * @returns
   * The best {@link ExecutableRoute} that can be used to execute a swap. If no executable route is found, null is returned.
   */
  findBestRoute(
    trade: Trade,
    opts?: Partial<RoutingOptions>,
    selectionOpts?: Partial<RouteSelectOptions>,
    fetchOpts?: WhirlpoolAccountFetchOptions
  ): Promise<ExecutableRoute | null>;

  /**
   * Construct a {@link TransactionBuilder} to help execute a trade route.
   * @param trade The trade route to execute.
   * @param slippage The slippage tolerance for the trade.
   * @param resolvedAtas
   * The ATA accounts that the executing wallet owns / needed by the execution.
   * If not provided, the router will attempt to resolve them.
   * @returns
   * A {@link TransactionBuilder}that can be used to execute the trade.
   * If provvided from {@link ExecutableRoute}, plug the {@link AddressLookupTableAccount}s
   * into builder to lower the transaction size.
   */
  swap(
    trade: TradeRoute,
    slippage: Percentage,
    resolvedAtas: AtaAccountInfo[] | null
  ): Promise<TransactionBuilder>;
}
