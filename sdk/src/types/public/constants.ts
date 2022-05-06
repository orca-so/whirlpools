import { PublicKey } from "@solana/web3.js";

/**
 * The number of rewards supported by this whirlpool.
 * @category Constants
 */
export const NUM_REWARDS = 3;

/**
 * @category Constants
 */
export const MAX_TICK_ARRAY_CROSSINGS = 2;

/**
 * @category Constants
 */
export const MAX_TICK_INDEX = 443636;

/**
 * @category Constants
 */
export const MIN_TICK_INDEX = -443636;

/**
 * @category Constants
 */
export const TICK_ARRAY_SIZE = 88;

/**
 * @category Constants
 */
export const MAX_SQRT_PRICE = "79226673515401279992447579055";

/**
 * @category Constants
 */
export const MIN_SQRT_PRICE = "4295048016";

/**
 * @category Constants
 */
export const METADATA_PROGRAM_ADDRESS = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
