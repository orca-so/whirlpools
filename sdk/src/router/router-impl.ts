import { Address } from "@coral-xyz/anchor";
import { AddressUtil, Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { Account } from "@solana/spl-token";
import { WhirlpoolContext } from "..";
import { RouteQueryErrorCode, SwapErrorCode, WhirlpoolsError } from "../errors/errors";
import { getSwapFromRoute } from "../instructions/composites/swap-with-route";
import {
  IGNORE_CACHE,
  PREFER_CACHE,
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
} from "../network/public/fetcher";
import { Path, PoolGraph, SwapUtils } from "../utils/public";
import { getBestRoutesFromQuoteMap } from "./convert-quote-map";
import {
  ExecutableRoute,
  RouteSelectOptions,
  RouterUtils,
  RoutingOptions,
  Trade,
  TradeRoute,
  WhirlpoolRouter,
} from "./public";
import { getQuoteMap } from "./quote-map";

export class WhirlpoolRouterImpl implements WhirlpoolRouter {
  constructor(readonly ctx: WhirlpoolContext, readonly poolGraph: PoolGraph) {}

  async findAllRoutes(
    trade: Trade,
    opts?: Partial<RoutingOptions>,
    fetchOpts?: WhirlpoolAccountFetchOptions
  ): Promise<TradeRoute[]> {
    const { tokenIn, tokenOut, tradeAmount, amountSpecifiedIsInput } = trade;
    const paths = this.poolGraph.getPath(tokenIn, tokenOut);

    if (paths.length === 0) {
      return Promise.reject(
        new WhirlpoolsError(
          `Could not find route for ${tokenIn} -> ${tokenOut}`,
          RouteQueryErrorCode.RouteDoesNotExist
        )
      );
    }

    if (tradeAmount.isZero()) {
      return Promise.reject(
        new WhirlpoolsError(
          `findBestRoutes error - input amount is zero.`,
          RouteQueryErrorCode.ZeroInputAmount
        )
      );
    }

    const routingOptions = { ...RouterUtils.getDefaultRouteOptions(), ...opts };
    const { program, fetcher } = this.ctx;
    const programId = program.programId;

    await prefetchRoutes(paths, programId, fetcher, fetchOpts);

    try {
      const [quoteMap, failures] = await getQuoteMap(
        trade,
        paths,
        amountSpecifiedIsInput,
        programId,
        fetcher,
        routingOptions
      );
      const bestRoutes = getBestRoutesFromQuoteMap(
        quoteMap,
        amountSpecifiedIsInput,
        routingOptions
      );

      // TODO: Rudementary implementation to determine error. Find a better solution
      if (bestRoutes.length === 0) {
        // TODO: TRADE_AMOUNT_TOO_HIGH actually corresponds to TickArrayCrossingAboveMax. Fix swap quote.
        if (failures.has(SwapErrorCode.TickArraySequenceInvalid)) {
          return Promise.reject(
            new WhirlpoolsError(
              `All swap quote generation failed on amount too high.`,
              RouteQueryErrorCode.TradeAmountTooHigh
            )
          );
        }
      }

      return bestRoutes;
    } catch (e: any) {
      return Promise.reject(
        new WhirlpoolsError(
          `Stack error received on quote generation.`,
          RouteQueryErrorCode.General,
          e.stack
        )
      );
    }
  }

  async findBestRoute(
    trade: Trade,
    routingOpts?: Partial<RoutingOptions>,
    selectionOpts?: Partial<RouteSelectOptions>,
    fetchOpts?: WhirlpoolAccountFetchOptions
  ): Promise<ExecutableRoute | null> {
    const allRoutes = await this.findAllRoutes(trade, routingOpts, fetchOpts);
    const selectOpts = { ...RouterUtils.getDefaultSelectOptions(), ...selectionOpts };
    return await RouterUtils.selectFirstExecutableRoute(this.ctx, allRoutes, selectOpts);
  }

  async swap(
    trade: TradeRoute,
    slippage: Percentage,
    resolvedAtas: Account[] | null
  ): Promise<TransactionBuilder> {
    const txBuilder = await getSwapFromRoute(
      this.ctx,
      {
        route: trade,
        slippage,
        resolvedAtaAccounts: resolvedAtas,
        wallet: this.ctx.wallet.publicKey,
      },
      IGNORE_CACHE
    );
    return txBuilder;
  }
}

// Load all pool and tick-array data into the fetcher cache.
async function prefetchRoutes(
  paths: Path[],
  programId: Address,
  fetcher: WhirlpoolAccountFetcherInterface,
  opts: WhirlpoolAccountFetchOptions = PREFER_CACHE
): Promise<void> {
  const poolSet = new Set<string>();
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    for (let j = 0; j < path.edges.length; j++) {
      poolSet.add(AddressUtil.toString(path.edges[j].poolAddress));
    }
  }

  const ps = Array.from(poolSet);
  const allWps = await fetcher.getPools(ps, opts);

  const tickArrayAddresses = [];
  for (const [key, wp] of allWps) {
    if (wp == null) {
      continue;
    }
    const addr1 = SwapUtils.getTickArrayPublicKeys(
      wp.tickCurrentIndex,
      wp.tickSpacing,
      true,
      AddressUtil.toPubKey(programId),
      AddressUtil.toPubKey(key)
    );
    const addr2 = SwapUtils.getTickArrayPublicKeys(
      wp.tickCurrentIndex,
      wp.tickSpacing,
      false,
      AddressUtil.toPubKey(programId),
      AddressUtil.toPubKey(key)
    );
    const allAddrs = [...addr1, ...addr2].map((k) => k.toBase58());
    const unique = Array.from(new Set(allAddrs));
    tickArrayAddresses.push(...unique);
  }

  await fetcher.getTickArrays(tickArrayAddresses, opts);
}
