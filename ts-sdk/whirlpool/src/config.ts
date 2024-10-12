import { getWhirlpoolsConfigExtensionAddress } from "@orca-so/whirlpools-client";
import type { Address, TransactionPartialSigner } from "@solana/web3.js";
import { address, createNoopSigner } from "@solana/web3.js";

export const DEFAULT_ADDRESS = address("11111111111111111111111111111111");

export let WHIRLPOOLS_CONFIG_ADDRESS: Address = address(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
);
export let WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Address = address(
  "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH",
);

export async function setWhirlpoolsConfig(
  whirlpoolsConfigAddress: Address,
): Promise<void> {
  WHIRLPOOLS_CONFIG_ADDRESS = whirlpoolsConfigAddress;
  WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS = await getWhirlpoolsConfigExtensionAddress(whirlpoolsConfigAddress).then((x) => x[0]);
}

export const SPLASH_POOL_TICK_SPACING = 32896;

export let DEFAULT_FUNDER: TransactionPartialSigner =
  createNoopSigner(DEFAULT_ADDRESS);

export function setDefaultFunder(
  funder: TransactionPartialSigner | Address,
): void {
  if (typeof funder === "string") {
    DEFAULT_FUNDER = createNoopSigner(funder);
  } else {
    DEFAULT_FUNDER = funder;
  }
}

export let DEFAULT_SLIPPAGE_TOLERANCE_BPS = 100;

export function setDefaultSlippageToleranceBps(slippageToleranceBps: number): void {
  DEFAULT_SLIPPAGE_TOLERANCE_BPS = Math.floor(slippageToleranceBps);
}

/**
 * Keypair:
 * Create auxillary token account using keypair.
 * Optionally add funds to account.
 * Close account at the end of tx.
 *
 * Seed:
 * Same as Keypair but then with a seed account.
 *
 * ATA:
 * Create ata (if needed) for NATIVE_MINT
 * Optionally add funds to ata.
 * Close ata at the end of tx if it did not exist before the tx.
 *
 * None:
 * Use/create ata and do not do any wrapping / unwrapping of SOL
 */
export type SolWrappingStrategy = "keypair" | "seed" | "ata" | "none";

export let SOL_WRAPPING_STRATEGY: SolWrappingStrategy = "keypair";

export function setSolWrappingStrategy(strategy: SolWrappingStrategy): void {
  SOL_WRAPPING_STRATEGY = strategy;
}

export async function resetConfiguration(): Promise<void> {
  await setWhirlpoolsConfig(address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"));
  setDefaultFunder(DEFAULT_ADDRESS);
  setDefaultSlippageToleranceBps(100);
  setSolWrappingStrategy("ata");
}
