import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";

/**
 * A utility class for working with pool graphs
 * @category PoolGraph
 */
export class PoolGraphUtils {
  static readonly ROUTE_ID_DELIMITER = "-";

  /**
   * Get a search route id from two tokens. The id can be used to identify a route between the two tokens in {@link RouteSearchEntires}.
   * @param tokenA The first token in the route
   * @param tokenB The second token in the route
   * @returns A route id that can be used to identify a route between the two tokens in {@link RouteSearchEntires}.
   */
  static getSearchRouteId(tokenA: Address, tokenB: Address): string {
    return `${AddressUtil.toString(tokenA)}${
      PoolGraphUtils.ROUTE_ID_DELIMITER
    }${AddressUtil.toString(tokenB)}`;
  }

  /**
   * Deconstruct a route id into the two tokens it represents
   * @param routeId - The route id to deconstruct
   * @returns A tuple of the two tokens in the route id. Returns undefined if the provided routeId is invalid.
   */
  static deconstructRouteId(routeId: string): [string, string] {
    const split = routeId.split(PoolGraphUtils.ROUTE_ID_DELIMITER);

    if (split.length !== 2) {
      throw new Error(`Invalid route id: ${routeId}`);
    }

    const [tokenA, tokenB] = split;
    return [tokenA, tokenB];
  }
}
