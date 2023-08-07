import {
  AddressUtil,
  LookupTableFetcher,
  MEASUREMENT_BLOCKHASH,
  Percentage,
  TransactionBuilder,
  TX_SIZE_LIMIT,
} from "@orca-so/common-sdk";
import { Account } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { ExecutableRoute, RoutingOptions, Trade, TradeRoute } from ".";
import { WhirlpoolContext } from "../../context";
import { getSwapFromRoute } from "../../instructions/composites/swap-with-route";
import { PREFER_CACHE } from "../../network/public/fetcher";
import { U64 } from "../../utils/math/constants";
import { PriceMath } from "../../utils/public";
import { isWalletConnected } from "../../utils/wallet-utils";

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
 * @param maxSupportedTransactionVersion The maximum transaction version that the wallet supports.
 * @param maxTransactionSize The maximum transaction size that the wallet supports.
 * @param availableAtaAccounts A list of ATA accounts that are available in this wallet to use for the swap.
 * @param onRouteEvaluation
 * A callback that is called right before a route is evaluated. Users have a chance to add additional instructions
 * to be added for an accurate txn size measurement. (ex. Adding a priority fee ix to the transaction)
 *
 */
export type RouteSelectOptions = {
  maxSupportedTransactionVersion: "legacy" | number;
  maxTransactionSize: number;
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
        if (legacyTxSize !== undefined && legacyTxSize <= opts.maxTransactionSize) {
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

          if (v0TxSize !== undefined && v0TxSize <= opts.maxTransactionSize) {
            return [route, lookupTableAccounts];
          }
        } catch (e) {
          // No-op
        }
      }
    }

    return null;
  }

  /**
   * Calculate the price impact for a route.
   * @param trade The trade the user used to derive the route.
   * @param route The route to calculate the price impact for.
   * @returns A Decimal object representing the percentage value of the price impact (ex. 3.01%)
   */
  static getPriceImpactForRoute(trade: Trade, route: TradeRoute): Decimal {
    const { amountSpecifiedIsInput } = trade;

    const totalBaseValue = route.subRoutes.reduce((acc, route) => {
      const directionalHops = amountSpecifiedIsInput
        ? route.hopQuotes
        : route.hopQuotes.slice().reverse();
      const baseOutputs = directionalHops.reduce((acc, quote, index) => {
        const { snapshot } = quote;
        const { aToB, sqrtPrice, feeRate } = snapshot;
        // Inverse sqrt price will cause 1bps precision loss since ticks are spaces of 1bps
        const directionalSqrtPrice = aToB ? sqrtPrice : PriceMath.invertSqrtPriceX64(sqrtPrice);

        // Convert from in/out -> base_out/in using the directional price & fee rate
        let nextBaseValue;
        const price = directionalSqrtPrice.mul(directionalSqrtPrice).div(U64);
        if (amountSpecifiedIsInput) {
          const amountIn = index === 0 ? quote.amountIn : acc[index - 1];
          const feeAdjustedAmount = amountIn
            .mul(feeRate.denominator.sub(feeRate.numerator))
            .div(feeRate.denominator);
          nextBaseValue = price.mul(feeAdjustedAmount).div(U64);
        } else {
          const amountOut = index === 0 ? quote.amountOut : acc[index - 1];
          const feeAdjustedAmount = amountOut.mul(U64).div(price);
          nextBaseValue = feeAdjustedAmount
            .mul(feeRate.denominator)
            .div(feeRate.denominator.sub(feeRate.numerator));
        }

        acc.push(nextBaseValue);
        return acc;
      }, new Array<BN>());

      return acc.add(baseOutputs[baseOutputs.length - 1]);
    }, new BN(0));

    const totalBaseValueDec = new Decimal(totalBaseValue.toString());
    const totalAmountEstimatedDec = new Decimal(
      amountSpecifiedIsInput ? route.totalAmountOut.toString() : route.totalAmountIn.toString()
    );
    const priceImpact = amountSpecifiedIsInput
      ? totalBaseValueDec.sub(totalAmountEstimatedDec).div(totalBaseValueDec)
      : totalAmountEstimatedDec.sub(totalBaseValueDec).div(totalAmountEstimatedDec);

    return priceImpact.mul(100);
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
      maxTransactionSize: TX_SIZE_LIMIT,
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
