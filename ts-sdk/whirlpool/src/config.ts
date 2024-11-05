import { getWhirlpoolsConfigExtensionAddress } from "@orca-so/whirlpools-client";
import type { Address, TransactionSigner } from "@solana/web3.js";
import { address, createNoopSigner, isAddress } from "@solana/web3.js";

/**
 * The default (null) address.
 */
export const DEFAULT_ADDRESS = address("11111111111111111111111111111111");

/**
 * The WhirlpoolsConfig addresses for various networks.
 */
export const DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES = {
  solanaMainnet: address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"),
  solanaDevnet: address("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"),
  eclipseMainnet: address("FVG4oDbGv16hqTUbovjyGmtYikn6UBEnazz6RVDMEFwv"),
  eclipseTestnet: address("FPydDjRdZu9sT7HVd6ANhfjh85KLq21Pefr5YWWMRPFp"),
};

/**
 * The default WhirlpoolsConfigExtension address.
 */
export const DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS = address(
  "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH",
);

/**
 * The WhirlpoolsConfig address.
 */
export let WHIRLPOOLS_CONFIG_ADDRESS: Address =
  DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES.solanaMainnet;

/**
 * The WhirlpoolsConfigExtension address.
 */
export let WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Address =
  DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS;

/**
 * Updates the WhirlpoolsConfig and WhirlpoolsConfigExtension addresses.
 *
 * @param {Address | keyof typeof NETWORK_ADDRESSES} config - A WhirlpoolsConfig address or a network name.
 * @returns {Promise<void>} - Resolves when the addresses have been updated.
 */
export async function setWhirlpoolsConfig(
  config: Address | keyof typeof DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES,
): Promise<void> {
  if (isAddress(config)) {
    WHIRLPOOLS_CONFIG_ADDRESS = config;
  } else {
    WHIRLPOOLS_CONFIG_ADDRESS =
      DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES[
        config as keyof typeof DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES
      ];
  }

  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS =
    await getWhirlpoolsConfigExtensionAddress(WHIRLPOOLS_CONFIG_ADDRESS).then(
      (x) => x[0],
    );
}

/**
 * The tick spacing for the Splash pools.
 */
export const SPLASH_POOL_TICK_SPACING = 32896;

/**
 * The default funder for transactions. No explicit funder specified.
 */
export const DEFAULT_FUNDER: TransactionSigner =
  createNoopSigner(DEFAULT_ADDRESS);

/**
 * The currently selected funder for transactions.
 */
export let FUNDER: TransactionSigner = DEFAULT_FUNDER;

/**
 * Sets the default funder for transactions.
 *
 * @param {TransactionSigner | Address | null} funder - The funder to be set as default, either as an address or a transaction signer.
 */
export function setDefaultFunder(
  funder: TransactionSigner | Address | null,
): void {
  if (typeof funder === "string") {
    FUNDER = createNoopSigner(funder);
  } else {
    FUNDER = funder ?? createNoopSigner(DEFAULT_ADDRESS);
  }
}

/**
 * The default slippage tolerance, expressed in basis points. Value of 100 is equivalent to 1%.
 */
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 100;

/**
 * The currently selected slippage tolerance, expressed in basis points. Value of 100 is equivalent to 1%.
 */
export let SLIPPAGE_TOLERANCE_BPS = DEFAULT_SLIPPAGE_TOLERANCE_BPS;

/**
 * Sets the default slippage tolerance for transactions.
 *
 * @param {number} slippageToleranceBps - The slippage tolerance, expressed basis points. Value of 100 is equivalent to 1%.
 */
export function setDefaultSlippageToleranceBps(
  slippageToleranceBps: number,
): void {
  SLIPPAGE_TOLERANCE_BPS = Math.floor(slippageToleranceBps);
}

/**
 * Defines the strategy for handling Native Mint wrapping in a transaction.
 *
 * - **Keypair**:
 *   Creates an auxiliary token account using a keypair.
 *   Optionally adds funds to the account.
 *   Closes it at the end of the transaction.
 *
 * - **Seed**:
 *   Functions similarly to Keypair, but uses a seed account instead.
 *
 * - **ATA**:
 *   Treats the native balance and associated token account (ATA) for `NATIVE_MINT` as one.
 *   Will create the ATA if it doesn't exist.
 *   Optionally adds funds to the account.
 *   Closes it at the end of the transaction if it did not exist before.
 *
 * - **None**:
 *   Uses or creates the ATA without performing any Native Mint wrapping or unwrapping.
 */
export type NativeMintWrappingStrategy = "keypair" | "seed" | "ata" | "none";

/**
 * The default native mint wrapping strategy.
 */
export const DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY: NativeMintWrappingStrategy =
  "keypair";

/**
 * The currently selected native mint wrapping strategy.
 */
export let NATIVE_MINT_WRAPPING_STRATEGY: NativeMintWrappingStrategy =
  DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;

/**
 * Sets the native mint wrapping strategy.
 *
 * @param {NativeMintWrappingStrategy} strategy - The native mint wrapping strategy.
 */
export function setNativeMintWrappingStrategy(
  strategy: NativeMintWrappingStrategy,
): void {
  NATIVE_MINT_WRAPPING_STRATEGY = strategy;
}

/**
 * Resets the configuration to its default state.
 *
 * @returns {Promise<void>} - Resolves when the configuration has been reset.
 */
export function resetConfiguration() {
  WHIRLPOOLS_CONFIG_ADDRESS = DEFAULT_WHIRLPOOLS_CONFIG_ADDRESS;
  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS =
    DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS;
  FUNDER = DEFAULT_FUNDER;
  SLIPPAGE_TOLERANCE_BPS = DEFAULT_SLIPPAGE_TOLERANCE_BPS;
  NATIVE_MINT_WRAPPING_STRATEGY = DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;
}
