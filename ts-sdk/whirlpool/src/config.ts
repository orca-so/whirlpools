import type { TransactionSigner, KeyPairSigner } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  address,
  createNoopSigner,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
} from "@solana/kit";

export {
  setComputeUnitMarginMultiplier,
  setJitoBlockEngineUrl,
  setJitoTipSetting,
  setPriorityFeeSetting,
  setRpc,
  setJitoFeePercentile,
  setPriorityFeePercentile,
  getRpcConfig,
} from "@orca-so/tx-sender";

export {
  WhirlpoolDeployment,
  DEFAULT_WHIRLPOOL_DEPLOYMENT,
} from "@orca-so/whirlpools-client";

/**
 * The default (null) address.
 */
export const DEFAULT_ADDRESS: Address = address(
  "11111111111111111111111111111111",
);

/**
 * The tick spacing for the Splash pools.
 */
export const SPLASH_POOL_TICK_SPACING = 32896;

/**
 * The default funder for transactions. No explicit funder specified.
 */
export const DEFAULT_FUNDER: TransactionSigner<string> =
  createNoopSigner(DEFAULT_ADDRESS);

/**
 * The currently selected funder for transactions.
 */
export let FUNDER: TransactionSigner<string> = DEFAULT_FUNDER;

/**
 * Sets the default funder for transactions.
 *
 * @param {TransactionSigner | Address | null} funder - The funder to be set as default, either as an address or a transaction signer.
 */
export function setDefaultFunder(
  funder: TransactionSigner<string> | Address | null,
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
 * The default setting for enforcing balance checks during token account preparation.
 */
export const DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK = false;

/**
 * The currently selected setting for enforcing balance checks during token account preparation.
 * When true, the system will assert that token accounts have sufficient balance before proceeding.
 * When false, balance checks are skipped, allowing users to get quotes and instructions even with insufficient balance.
 */
export let ENFORCE_TOKEN_BALANCE_CHECK = DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK;

/**
 * Sets whether to enforce balance checks during token account preparation.
 *
 * @param {boolean} enforceBalanceCheck - When true, the system will assert that token accounts have sufficient balance. When false, balance checks are skipped.
 */
export function setEnforceTokenBalanceCheck(
  enforceBalanceCheck: boolean,
): void {
  ENFORCE_TOKEN_BALANCE_CHECK = enforceBalanceCheck;
}

/**
 * Resets the configuration to its default state.
 *
 * @returns {void} Resolves when the configuration has been reset.
 */
export function resetConfiguration() {
  FUNDER = DEFAULT_FUNDER;
  SLIPPAGE_TOLERANCE_BPS = DEFAULT_SLIPPAGE_TOLERANCE_BPS;
  NATIVE_MINT_WRAPPING_STRATEGY = DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;
  ENFORCE_TOKEN_BALANCE_CHECK = DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK;
}

let _payer: KeyPairSigner | undefined;

/**
 * Sets the payer from a private key byte array.
 *
 * @param {Uint8Array<ArrayBuffer>} pkBytes - The private key bytes to create the payer from.
 * @returns {Promise<KeyPairSigner>} - A promise that resolves to the created signer.
 *
 * @example
 * ```ts
 * // Set payer from a private key byte array
 * const privateKeyBytes = new Uint8Array([
 *   55, 244, 186, 115, 93, 3, 9, 47, 12, 168,
 *   86, 1, 5, 155, 127, 3, 44, 165, 155, 3,
 *   112, 1, 3, 99, 3, 211, 3, 77, 153,
 *   44, 1, 179
 * ]);
 * const signer = await setPayerFromBytes(privateKeyBytes);
 * ```
 */
export async function setPayerFromBytes(pkBytes: Uint8Array<ArrayBuffer>) {
  const kp = await createKeyPairFromBytes(pkBytes);
  const signer = await createSignerFromKeyPair(kp);
  _payer = signer;
  return signer;
}

export function getPayer(): KeyPairSigner {
  if (!_payer) {
    throw new Error("Payer not set. Call setPayer() first.");
  }
  return _payer;
}
