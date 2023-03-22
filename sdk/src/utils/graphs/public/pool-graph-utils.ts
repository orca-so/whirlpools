import { AddressUtil } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";

/**
 * A utility class for working with pool graphs
 * @category PoolGraph
 */
export class PoolGraphUtils {
  static readonly PATH_ID_DELIMITER = "-";

  /**
   * Get a search path id from two tokens. The id can be used to identify a path between the two tokens in {@link RouteSearchEntires}.
   * @param tokenA The first token in the path
   * @param tokenB The second token in the path
   * @returns A path id that can be used to identify a path between the two tokens in {@link RouteSearchEntires}.
   */
  static getSearchPathId(tokenA: Address, tokenB: Address): string {
    return `${AddressUtil.toString(tokenA)}${
      PoolGraphUtils.PATH_ID_DELIMITER
    }${AddressUtil.toString(tokenB)}`;
  }

  /**
   * Deconstruct a path id into the two tokens it represents
   * @param pathId - The path id to deconstruct
   * @returns A tuple of the two tokens in the path id. Returns undefined if the provided pathId is invalid.
   */
  static deconstructPathId(pathId: string): [string, string] {
    const split = pathId.split(PoolGraphUtils.PATH_ID_DELIMITER);

    if (split.length !== 2) {
      throw new Error(`Invalid path id: ${pathId}`);
    }

    const [tokenA, tokenB] = split;
    return [tokenA, tokenB];
  }
}
