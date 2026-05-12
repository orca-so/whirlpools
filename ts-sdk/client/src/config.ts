import type { Address } from "@solana/kit";
import { address } from "@solana/kit";

/** The Whirlpools program's address for Solana Mainnet. */
const WHIRLPOOLS_PROGRAM_ADDRESS: Address = address(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);

/** The Whirlpools program's config account address for Solana Mainnet. */
const MAINNET_WHIRLPOOLS_CONFIG_ADDRESS: Address = address(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
);

/** The Whirlpools program's config account address for Solana Devnet. */
const DEVNET_WHIRLPOOLS_CONFIG_ADDRESS: Address = address(
  "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR",
);

/** The Immutable Whirlpools program's address for Solana Mainnet. */
const IMMUTABLE_WHIRLPOOLS_PROGRAM_ADDRESS: Address = address(
  "iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN",
);

/** The Immutable Whirlpools program's config account address for Solana Mainnet. */
const MAINNET_IMMUTABLE_WHIRLPOOLS_CONFIG_ADDRESS: Address = address(
  "8pm8erUsaMpmZ47LttHAPgnDx7xGZUvxY4q47vTCs5Nj",
);

/**
 * Identifies a deployed whirlpool program and the config account it operates against.
 *
 * PDA derivation and instruction targeting both depend on these two values, so they
 * are bundled together to keep them consistent. Pass a `WhirlpoolDeployment` (or omit
 * it to fall back to `DEFAULT_WHIRLPOOL_DEPLOYMENT`, the mutable mainnet program) to the
 * SDK functions and PDA helpers that accept it.
 *
 * Use the named constants ({@link WhirlpoolDeployment.mainnet}, {@link WhirlpoolDeployment.devnet},
 * {@link WhirlpoolDeployment.mainnetImmutable}) for the official deployments, or
 * {@link WhirlpoolDeployment.custom} to point at a fork or local deployment.
 */
export type WhirlpoolDeployment = {
  /** The program id of the targeted whirlpool program. */
  readonly programId: Address;
  /** The `WhirlpoolsConfig` account address that pairs with this program. */
  readonly configAddress: Address;
};

export const WhirlpoolDeployment = {
  /** The mutable whirlpool program on Solana Mainnet, paired with its mainnet config account. */
  mainnet: {
    programId: WHIRLPOOLS_PROGRAM_ADDRESS,
    configAddress: MAINNET_WHIRLPOOLS_CONFIG_ADDRESS,
  } as WhirlpoolDeployment,

  /** The mutable whirlpool program on Solana Devnet, paired with its devnet config account. */
  devnet: {
    programId: WHIRLPOOLS_PROGRAM_ADDRESS,
    configAddress: DEVNET_WHIRLPOOLS_CONFIG_ADDRESS,
  } as WhirlpoolDeployment,

  /** The immutable whirlpool program on Solana Mainnet, paired with its mainnet config account. */
  mainnetImmutable: {
    programId: IMMUTABLE_WHIRLPOOLS_PROGRAM_ADDRESS,
    configAddress: MAINNET_IMMUTABLE_WHIRLPOOLS_CONFIG_ADDRESS,
  } as WhirlpoolDeployment,

  /**
   * Targets an arbitrary `programId` / `configAddress` pair — useful for forks, local
   * validators, or any deployment not covered by the named constants.
   */
  custom: (
    programId: Address,
    configAddress: Address,
  ): WhirlpoolDeployment => ({
    programId,
    configAddress,
  }),
} as const;

/** The default {@link WhirlpoolDeployment} (mutable mainnet). */
export const DEFAULT_WHIRLPOOL_DEPLOYMENT: WhirlpoolDeployment =
  WhirlpoolDeployment.mainnet;
