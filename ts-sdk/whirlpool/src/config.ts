import { getWhirlpoolsConfigExtensionAddress } from "@orca-so/whirlpools-client";
import type { Address, TransactionSigner } from "@solana/web3.js";
import { address, createNoopSigner } from "@solana/web3.js";

/**
 * The default (null) address.
 */
export const DEFAULT_ADDRESS = address("11111111111111111111111111111111");

/**
 * The WhirlpoolsConfig addresses for various networks.
 */
export const WHIRLPOOLS_CONFIG_ADDRESSES = {
  SolanaMainnet: address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"),
  SolanaDevnet: address("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"),
  EclipseMainnet: address("FVG4oDbGv16hqTUbovjyGmtYikn6UBEnazz6RVDMEFwv"),
  EclipseTestnet: address("FPydDjRdZu9sT7HVd6ANhfjh85KLq21Pefr5YWWMRPFp"),
};

/**
 * The default WhirlpoolsConfig address.
 */
export const DEFAULT_WHIRLPOOLS_CONFIG_ADDRESS =
  WHIRLPOOLS_CONFIG_ADDRESSES.SolanaMainnet;

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
  DEFAULT_WHIRLPOOLS_CONFIG_ADDRESS;

/**
 * The WhirlpoolsConfigExtension address.
 */
export let WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Address =
  DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS;

/**
 * Updates the WhirlpoolsConfig and WhirlpoolsConfigExtension addresses.
 *
 * @param {Address} whirlpoolsConfigAddress - A WhirlpoolsConfig address.
 * @returns {Promise<void>} - Resolves when the addresses have been updated.
 */
export async function setWhirlpoolsConfig(
  whirlpoolsConfigAddress: Address,
): Promise<void> {
  WHIRLPOOLS_CONFIG_ADDRESS = whirlpoolsConfigAddress;
  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS =
    await getWhirlpoolsConfigExtensionAddress(whirlpoolsConfigAddress).then(
      (x) => x[0],
    );
}

/**
 * Sets the WhirlpoolsConfig address based on the selected network.
 *
 * @param {keyof typeof WHIRLPOOLS_CONFIG_ADDRESSES} network - The network to set. Valid options are: SolanaMainnet, SolanaDevnet, EclipseMainnet, EclipseTestnet.
 * @throws {Error} If the network is invalid.
 */
export async function setNetwork(
  network: keyof typeof WHIRLPOOLS_CONFIG_ADDRESSES,
): Promise<void> {
  await setWhirlpoolsConfig(WHIRLPOOLS_CONFIG_ADDRESSES[network]);
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
 * Defines the strategy for handling SOL wrapping in a transaction.
 *
 * - **Keypair**:
 *   Creates an auxiliary token account using a keypair. Optionally adds funds to the account. Closes it at the end of the transaction.
 *
 * - **Seed**:
 *   Functions similarly to Keypair, but uses a seed account instead.
 *
 * - **ATA**:
 *   Creates an associated token account (ATA) for `NATIVE_MINT` if necessary. Optionally adds funds to the ATA. Closes it at the end of the transaction if it was newly created.
 *
 * - **None**:
 *   Uses or creates the ATA without performing any SOL wrapping or unwrapping.
 */
export type SolWrappingStrategy = "keypair" | "seed" | "ata" | "none";

/**
 * The default sol wrapping strategy.
 */
export const DEFAULT_SOL_WRAPPING_STRATEGY: SolWrappingStrategy = "keypair";

/**
 * The currently selected sol wrapping strategy.
 */
export let SOL_WRAPPING_STRATEGY: SolWrappingStrategy =
  DEFAULT_SOL_WRAPPING_STRATEGY;

/**
 * Sets the sol wrapping strategy.
 *
 * @param {SolWrappingStrategy} strategy - The sol wrapping strategy.
 */
export function setSolWrappingStrategy(strategy: SolWrappingStrategy): void {
  SOL_WRAPPING_STRATEGY = strategy;
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
  SOL_WRAPPING_STRATEGY = DEFAULT_SOL_WRAPPING_STRATEGY;
}
