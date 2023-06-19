import { Address } from "@coral-xyz/anchor";
import { WhirlpoolRouter } from ".";
import { WhirlpoolContext } from "../..";
import { PoolGraph, PoolGraphBuilder } from "../../utils/public";
import { WhirlpoolRouterImpl } from "../router-impl";

/**
 * Builder to build instances of the {@link WhirlpoolRouter}
 * @category Router
 */
export class WhirlpoolRouterBuilder {
  /**
   * Builds a {@link WhirlpoolRouter} with a prebuilt {@link PoolGraph}
   *
   * @param ctx A {@link WhirlpoolContext} for the current execution environment
   * @param graph A {@link PoolGraph} that represents the connections between all pools.
   * @returns A {@link WhirlpoolRouter} that can be used to find routes and execute swaps
   */
  static buildWithPoolGraph(ctx: WhirlpoolContext, graph: PoolGraph): WhirlpoolRouter {
    return new WhirlpoolRouterImpl(ctx, graph);
  }

  /**
   * Fetch and builds a {@link WhirlpoolRouter} with a list of pool addresses.
   * @param ctx A {@link WhirlpoolContext} for the current execution environment
   * @param pools A list of {@link Address}es that the router will find routes through.
   * @returns A {@link WhirlpoolRouter} that can be used to find routes and execute swaps
   */
  static async buildWithPools(ctx: WhirlpoolContext, pools: Address[]): Promise<WhirlpoolRouter> {
    const poolGraph = await PoolGraphBuilder.buildPoolGraphWithFetch(pools, ctx.cache);
    return new WhirlpoolRouterImpl(ctx, poolGraph);
  }
}
