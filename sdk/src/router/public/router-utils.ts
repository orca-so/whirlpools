import {
  AddressUtil,
  LookupTableFetcher,
  MEASUREMENT_BLOCKHASH,
  ONE,
  Percentage,
  TransactionBuilder,
  TX_SIZE_LIMIT,
  U64_MAX
} from "@orca-so/common-sdk";
import { Account } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { ExecutableRoute, RoutingOptions, TradeRoute } from ".";
import { WhirlpoolContext } from "../../context";
import { getSwapFromRoute } from "../../instructions/composites/swap-with-route";
import { PREFER_CACHE } from "../../network/public/fetcher";
import { PriceMath } from "../../utils/public";
import { isWalletConnected } from "../../utils/wallet-utils";

// TODO: Find a home
const U64 = U64_MAX.add(ONE);

/**
 * A type representing a Associated Token Account
 * @param address The address of the ATA account.
 * @param owner The owner address of the ATA.
 * @param mint The mint of the token the ATA represents.
 */
export type AtaAccountInfo = Pick<Account, "address" | "owner" | "mint">;

/**
 * Parameters to configure the selection of the best route.
 * @category Router
 * @param slippageTolerance The slippage tolerance to use when selecting the best route.
 * @param maxSupportedTransactionVersion The maximum transaction version that the wallet supports.
 * @param availableAtaAccounts A list of ATA accounts that are available in this wallet to use for the swap.
 * @param onRouteEvaluation
 * A callback that is called right before a route is evaluated. Users have a chance to add additional instructions
 * to be added for an accurate txn size measurement. (ex. Adding a priority fee ix to the transaction)
 *
 */
export type RouteSelectOptions = {
  maxSupportedTransactionVersion: "legacy" | number;
  availableAtaAccounts?: AtaAccountInfo[];
  onRouteEvaluation?: (route: Readonly<TradeRoute>, tx: TransactionBuilder) => void;
};

/**
 * A selection of utility functions for the {@link WhirlpoolRouter}.
 * @category Router
 */
export class RouterUtils {
  /**
   * Selects the best executable route from a list of routes using the current execution environment.
   * The wallet support type, available ATA accounts, existance of lookup tables all effect the transaction size
   * and eligibility of a route.
   *
   * @param ctx The {@link WhirlpoolContext} that represents the current execution environment
   * @param orderedRoutes A list of routes to select from, ordered by the best routes (trade amount wise) first.
   * @param opts {@link RouteSelectOptions} to configure the selection of the best route.
   * @returns
   * The best {@link ExecutableRoute} that can be used to execute a swap. If no executable route is found, null is returned.
   */
  static async selectFirstExecutableRoute(
    ctx: WhirlpoolContext,
    orderedRoutes: TradeRoute[],
    opts: RouteSelectOptions
  ): Promise<ExecutableRoute | null> {
    const { wallet } = ctx;

    if (orderedRoutes.length === 0) {
      return null;
    }

    // Don't measure if there is no wallet
    if (!isWalletConnected(wallet)) {
      return [orderedRoutes[0], undefined];
    }

    // Preload LookupTableFetcher with lookup tables that are needed for v0 transactions
    if (opts.maxSupportedTransactionVersion !== "legacy" && ctx.lookupTableFetcher) {
      await loadLookupTablesForRoutes(ctx.lookupTableFetcher, orderedRoutes);
    }

    for (let i = 0; i < orderedRoutes.length && i < MEASURE_ROUTE_MAX; i++) {
      const route = orderedRoutes[i];

      const tx = await getSwapFromRoute(
        ctx,
        {
          route,
          slippage: Percentage.fromFraction(0, 100),
          resolvedAtaAccounts: opts.availableAtaAccounts ?? null,
          wallet: wallet.publicKey,
        },
        PREFER_CACHE
      );

      if (!!opts.onRouteEvaluation) {
        opts.onRouteEvaluation(route, tx);
      }

      try {
        const legacyTxSize = tx.txnSize({
          latestBlockhash: MEASUREMENT_BLOCKHASH,
          maxSupportedTransactionVersion: "legacy",
        });
        if (legacyTxSize !== undefined && legacyTxSize <= TX_SIZE_LIMIT) {
          return [route, undefined];
        }
      } catch (e) {
        // No-op
      }

      let v0TxSize;
      if (opts.maxSupportedTransactionVersion !== "legacy" && ctx.lookupTableFetcher) {
        const addressesToLookup = RouterUtils.getTouchedTickArraysFromRoute(route);
        if (addressesToLookup.length > MAX_LOOKUP_TABLE_FETCH_SIZE) {
          continue;
        }

        const lookupTableAccounts = await ctx.lookupTableFetcher.getLookupTableAccountsForAddresses(
          addressesToLookup
        );
        try {
          v0TxSize = tx.txnSize({
            latestBlockhash: MEASUREMENT_BLOCKHASH,
            maxSupportedTransactionVersion: opts.maxSupportedTransactionVersion,
            lookupTableAccounts,
          });

          if (v0TxSize !== undefined && v0TxSize <= TX_SIZE_LIMIT) {
            return [route, lookupTableAccounts];
          }
        } catch (e) {
          // No-op
        }
      }
    }

    return null;
  }

  // TODO: Current flow for exact-in only. Implement exact-out
  static getPriceImpactForRoute(route: TradeRoute): number {
    // For each route, perform the following:
    // 1. Get the hop's amountIn. The first hop will always take the user input amount. Subsequent will be the output of the previous hop
    // 2. Determine the feeAdjustedAmountIn by multiplying the amountIn by (1-fee)
    // 3. Determine the price by multiplying the sqrtPrice by itself
    // 4. Determine the baseOutput by multiplying the price by the feeAdjustedAmountIn. Record it.
    // 5. Once the hop traversal is complete, get the hop's base amount out and aggregate it.
    // 6. The difference between the aggregated base amount out and the actual amount out is the price impact
    const totalBaseOutput = route.subRoutes.reduce((acc, route, routeIndex) => {
      const baseOutputs = route.hopQuotes.reduce((acc, quote, index) => {
        const { snapshot } = quote;
        const { aToB, sqrtPrice, totalFeeRate, amountSpecifiedIsInput } = snapshot
        // Inverse sqrt price will cause 1bps precision loss since ticks are spaces of 1bps
        const directionalSqrtPrice = aToB ? sqrtPrice : PriceMath.invertSqrtPriceX64(sqrtPrice);
        const amountIn = index === 0 ? quote.amountIn : acc[index - 1];

        const feeAdjustedAmountIn = amountIn.mul(totalFeeRate.denominator.sub(totalFeeRate.numerator)).div(totalFeeRate.denominator);
        const price = directionalSqrtPrice.mul(directionalSqrtPrice).div(U64);
        const nextBaseOutput = price.mul(feeAdjustedAmountIn).div(U64);
        const impact = new Decimal(nextBaseOutput.toString()).sub(quote.amountOut.toString()).div(nextBaseOutput.toString()).mul(100);
        console.log(`Base output for route ${routeIndex} hop ${index}:`);
        console.log(`aToB: ${aToB} amountSpecifiedIsInput: ${amountSpecifiedIsInput} amountIn: ${amountIn.toString()} Fee adjusted amount in: ${feeAdjustedAmountIn.toString()}, directional sqrt price: ${directionalSqrtPrice.toString()}`);
        console.log(`Total fee rate: ${totalFeeRate.toString()}, price: ${price.toString()}`);
        console.log(`Base output: ${nextBaseOutput.toString()} actual - ${quote.amountOut} impact - ${impact.toString()}`)
        console.log(`\n`);
        acc.push(nextBaseOutput);
        return acc;
      }, new Array<BN>());

      return acc.add(baseOutputs[baseOutputs.length - 1]);
    }, new BN(0));

    const totalBaseOutputDecimal = new Decimal(totalBaseOutput.toString());
    const priceImpact = totalBaseOutputDecimal.sub(route.totalAmountOut.toString()).div(totalBaseOutputDecimal);
    console.log(`Total base output: ${totalBaseOutput.toString()}, actual amount in : ${route.totalAmountIn.toString()} actual amount out: ${route.totalAmountOut.toString()}, price impact: ${priceImpact.toString()}`);

    return priceImpact.toNumber();
  }

  /**
   * Get the tick arrays addresses that are touched by a route.
   * @param route The route to get the tick arrays from.
   * @returns The tick arrays addresses that are touched by the route.
   */
  static getTouchedTickArraysFromRoute(route: TradeRoute): PublicKey[] {
    const taAddresses = new Set<string>();
    for (const quote of route.subRoutes) {
      for (const hop of quote.hopQuotes) {
        // We only need to search for tick arrays, since we should be guaranteed due to the layout
        // that all other addresses are included in the LUTs for the tick array
        taAddresses.add(hop.quote.tickArray0.toBase58());
        taAddresses.add(hop.quote.tickArray1.toBase58());
        taAddresses.add(hop.quote.tickArray2.toBase58());
      }
    }
    return AddressUtil.toPubKeys(Array.from(taAddresses));
  }

  /**
   * Get the default options for generating trade routes.
   * @returns Default options for generating trade routes.
   */
  static getDefaultRouteOptions(): RoutingOptions {
    return {
      percentIncrement: 20,
      numTopRoutes: 50,
      numTopPartialQuotes: 10,
      maxSplits: 3,
    };
  }

  /**
   * Get the default options for selecting a route from a list of generated routes.
   * @returns Default options for selecting a a route from a list of generated routes.
   */
  static getDefaultSelectOptions(): RouteSelectOptions {
    return {
      maxSupportedTransactionVersion: 0,
    };
  }
}

async function loadLookupTablesForRoutes(
  lookupTableFetcher: LookupTableFetcher,
  routes: TradeRoute[]
) {
  const altTicks = new Set<string>();
  for (let i = 0; i < routes.length && i < MEASURE_ROUTE_MAX; i++) {
    const route = routes[i];
    RouterUtils.getTouchedTickArraysFromRoute(route).map((ta) => altTicks.add(ta.toBase58()));
  }
  const altTickArray = Array.from(altTicks);
  const altPageSize = 45;
  const altRequests = [];
  for (let i = 0; i < altTickArray.length; i += altPageSize) {
    altRequests.push(altTickArray.slice(i, i + altPageSize));
  }
  await Promise.all(
    altRequests.map((altPage) => {
      const altPageKeys = AddressUtil.toPubKeys(altPage);
      lookupTableFetcher.loadLookupTables(altPageKeys);
    })
  );
}

// The maximum number of routes to measure
const MEASURE_ROUTE_MAX = 100;

// The maximum number of tick arrays to lookup per network request
const MAX_LOOKUP_TABLE_FETCH_SIZE = 50;
