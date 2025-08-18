import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { TickArrayData, WhirlpoolRewardInfoData } from "./anchor-types";
import type {
  AccountWithTokenProgram,
  MintWithTokenProgram,
} from "@orca-so/common-sdk";

/**
 * Extended Mint type to host token info.
 * @category WhirlpoolClient
 */
export type TokenInfo = MintWithTokenProgram & { mint: PublicKey };

/**
 * Extended (token) Account type to host account info for a Token.
 * @category WhirlpoolClient
 */
export type TokenAccountInfo = AccountWithTokenProgram;

/**
 * Type to represent a reward for a reward index on a Whirlpool.
 * @category WhirlpoolClient
 */
export type WhirlpoolRewardInfo = WhirlpoolRewardInfoData & {
  initialized: boolean;
  vaultAmount: BN;
};

/**
 * A wrapper class of a TickArray on a Whirlpool
 * @category WhirlpoolClient
 */
export type TickArray = {
  address: PublicKey;
  startTickIndex: number;
  data: TickArrayData | null;
};

/**
 * Object to represent the control flags of a Whirlpool.
 * @category WhirlpoolClient
 */
export type WhirlpoolControlFlags = {
  requireNonTransferablePosition: boolean;
};

/**
 * Whirlpool extension segment primary.
 * @category WhirlpoolClient
 */
export type WhirlpoolExtensionSegmentPrimary = {
  controlFlags: WhirlpoolControlFlags;
  // reserved for future use
};

/**
 * Whirlpool extension segment secondary.
 * @category WhirlpoolClient
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type WhirlpoolExtensionSegmentSecondary = {
  // reserved for future use
};

/**
 * Object to represent the feature flags of a WhirlpoolsConfig.
 * @category WhirlpoolClient
 */
export type ConfigFeatureFlags = {
  tokenBadge: boolean;
};
