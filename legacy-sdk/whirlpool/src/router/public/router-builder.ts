import type { Address } from "@coral-xyz/anchor";
import type { WhirlpoolRouter } from ".";
import type { WhirlpoolContext } from "../..";
import type { PoolGraph } from "../../utils/public";
import { PoolGraphBuilder } from "../../utils/public";
import { WhirlpoolRouterImpl } from "../router-impl";

/**
 * Builder to build instances of the {@link WhirlpoolRouter}
 * @category Router
 *
 * @deprecated WhirlpoolRouter will be removed in the future release. Please use endpoint which provides qoutes.
 */
export class WhirlpoolRouterBuilder {
  /**
   * Builds a {@link WhirlpoolRouter} with a prebuilt {@link PoolGraph}
   *
   * @param ctx A {@link WhirlpoolContext} for the current execution environment
   * @param graph A {@link PoolGraph} that represents the connections between all pools.
   * @returns A {@link WhirlpoolRouter} that can be used to find routes and execute swaps
   *
   * @deprecated WhirlpoolRouter will be removed in the future release. Please use endpoint which provides qoutes.
   */
  static buildWithPoolGraph(
    ctx: WhirlpoolContext,
    graph: PoolGraph,
  ): WhirlpoolRouter {
    return new WhirlpoolRouterImpl(ctx, graph);
  }

  /**
   * Fetch and builds a {@link WhirlpoolRouter} with a list of pool addresses.
   * @param ctx A {@link WhirlpoolContext} for the current execution environment
   * @param pools A list of {@link Address}es that the router will find routes through.
   * @returns A {@link WhirlpoolRouter} that can be used to find routes and execute swaps
   *
   * @deprecated WhirlpoolRouter will be removed in the future release. Please use endpoint which provides qoutes.
   */
  static async buildWithPools(
    ctx: WhirlpoolContext,
    pools: Address[],
  ): Promise<WhirlpoolRouter> {
    const poolGraph = await PoolGraphBuilder.buildPoolGraphWithFetch(
      pools,
      ctx.fetcher,
    );
    return new WhirlpoolRouterImpl(ctx, poolGraph);
  }
}
