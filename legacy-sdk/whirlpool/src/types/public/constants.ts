import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * Program ID hosting Orca's Whirlpool program.
 * @category Constants
 */
export const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);

/**
 * Orca's WhirlpoolsConfig PublicKey.
 * @category Constants
 */
export const ORCA_WHIRLPOOLS_CONFIG = new PublicKey(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
);

/**
 * Orca's WhirlpoolsConfig PublicKey for Eclipse
 * @category Constants
 */
export const ORCA_WHIRLPOOLS_CONFIG_ECLIPSE = new PublicKey(
    "FVG4oDbGv16hqTUbovjyGmtYikn6UBEnazz6RVDMEFwv",
);

/**
 * Orca's WhirlpoolsConfig PublicKey.
 * @category Constants
 */
export const ORCA_WHIRLPOOLS_CONFIG_EXTENSION = new PublicKey(
  "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH",
);

/**
 * Orca's supported tick spacings.
 * @category Constants
 */
export const ORCA_SUPPORTED_TICK_SPACINGS = [
  1, 2, 4, 8, 16, 64, 96, 128, 256, 32896,
];

/**
 * The number of rewards supported by this whirlpool.
 * @category Constants
 */
export const NUM_REWARDS = 3;

/**
 * The maximum tick index supported by the Whirlpool program.
 * @category Constants
 */
export const MAX_TICK_INDEX = 443636;

/**
 * The minimum tick index supported by the Whirlpool program.
 * @category Constants
 */
export const MIN_TICK_INDEX = -443636;

/**
 * The maximum sqrt-price supported by the Whirlpool program.
 * @category Constants
 */
export const MAX_SQRT_PRICE = "79226673515401279992447579055";

/**
 * The minimum sqrt-price supported by the Whirlpool program.
 * @category Constants
 */
export const MIN_SQRT_PRICE = "4295048016";

/**
 * The minimum sqrt-price supported by the Whirlpool program.
 * @category Constants
 */
export const MIN_SQRT_PRICE_BN = new BN(MIN_SQRT_PRICE);

/**
 * The maximum sqrt-price supported by the Whirlpool program.
 * @category Constants
 */
export const MAX_SQRT_PRICE_BN = new BN(MAX_SQRT_PRICE);

/**
 * The number of initialized ticks that a tick-array account can hold.
 * @category Constants
 */
export const TICK_ARRAY_SIZE = 88;

/**
 * The number of bundled positions that a position-bundle account can hold.
 * @category Constants
 */
export const POSITION_BUNDLE_SIZE = 256;

/**
 * @category Constants
 */
export const METADATA_PROGRAM_ADDRESS = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

/**
 * @category Constants
 */
export const MEMO_PROGRAM_ADDRESS = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

/**
 * The maximum number of tick-arrays that can traversed across in a swap.
 * @category Constants
 */
export const MAX_SWAP_TICK_ARRAYS = 3;

/**
 * The maximum number of supplemental tick-arrays that can be provided in a swap.
 * @category Constants
 */
export const MAX_SUPPLEMENTAL_TICK_ARRAYS = 3;

/**
 * The denominator which the protocol fee rate is divided on.
 * @category Constants
 */
export const PROTOCOL_FEE_RATE_MUL_VALUE = new BN(10_000);

/**
 * The denominator which the fee rate is divided on.
 * @category Constants
 */
export const FEE_RATE_MUL_VALUE = new BN(1_000_000);

/**
 * The public key that is allowed to update the metadata of Whirlpool NFTs.
 * @category Constants
 */
export const WHIRLPOOL_NFT_UPDATE_AUTH = new PublicKey(
  "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr",
);

/**
 * The tick spacing (inclusive) at which a whirlpool only supports full-range positions.
 * @category Constants
 */
export const FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD = 32768;

/**
 * The tick spacing for splash pools.
 * @category Constants
 */
export const SPLASH_POOL_TICK_SPACING = 32896;