import type { Idl } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import WhirlpoolIDL from "../../artifacts/whirlpool.json";

/**
 * This file contains the types that has the same structure as the types anchor functions returns.
 * These types are hard-casted by the client function.
 *
 * This file must be manually updated every time the idl updates as accounts will
 * be hard-casted to fit the type.
 */

/**
 * Supported parasable account names from the Whirlpool contract.
 * @category Network
 */
export enum AccountName {
  WhirlpoolsConfig = "WhirlpoolsConfig",
  Position = "Position",
  TickArray = "TickArray",
  DynamicTickArray = "DynamicTickArray",
  Whirlpool = "Whirlpool",
  FeeTier = "FeeTier",
  PositionBundle = "PositionBundle",
  WhirlpoolsConfigExtension = "WhirlpoolsConfigExtension",
  TokenBadge = "TokenBadge",
  LockConfig = "LockConfig",
  Oracle = "Oracle",
  AdaptiveFeeTier = "AdaptiveFeeTier",
}

export const WHIRLPOOL_IDL = WhirlpoolIDL as Idl;

/**
 * The Anchor coder for the Whirlpool program.
 * @category Solana Accounts
 */
export const WHIRLPOOL_CODER = new BorshAccountsCoder(WHIRLPOOL_IDL);

/**
 * Get the size of an account owned by the Whirlpool program in bytes.
 * @param accountName Whirlpool account name
 * @returns Size in bytes of the account
 */
export function getAccountSize(accountName: AccountName) {
  const size = WHIRLPOOL_CODER.size(
    WHIRLPOOL_IDL.accounts!.find((account) => account.name === accountName)!,
  );
  return size + RESERVED_BYTES[accountName];
}

/**
 * Reserved bytes for each account used for calculating the account size.
 */
const RESERVED_BYTES: ReservedBytes = {
  [AccountName.WhirlpoolsConfig]: 2,
  [AccountName.Position]: 0,
  [AccountName.TickArray]: 0,
  [AccountName.DynamicTickArray]: 0,
  [AccountName.Whirlpool]: 0,
  [AccountName.FeeTier]: 0,
  [AccountName.PositionBundle]: 64,
  [AccountName.WhirlpoolsConfigExtension]: 512,
  [AccountName.TokenBadge]: 128,
  [AccountName.LockConfig]: 128,
  [AccountName.Oracle]: 0, // reserved space is occupied as "reserved" field
  [AccountName.AdaptiveFeeTier]: 128,
};

type ReservedBytes = {
  [name in AccountName]: number;
};

/**
 * Size of the Whirlpool account in bytes.
 * @deprecated Please use {@link getAccountSize} instead.
 * @category Solana Accounts
 */
export const WHIRLPOOL_ACCOUNT_SIZE = getAccountSize(AccountName.Whirlpool);

/**
 * @category Solana Accounts
 */
export type WhirlpoolsConfigData = {
  feeAuthority: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  defaultFeeRate: number;
  defaultProtocolFeeRate: number;
};

/**
 * @category Solana Accounts
 */
export type WhirlpoolRewardInfoData = {
  mint: PublicKey;
  vault: PublicKey;
  authority: PublicKey;
  emissionsPerSecondX64: BN;
  growthGlobalX64: BN;
};

/**
 * @category Solana Accounts
 */
export type WhirlpoolBumpsData = {
  whirlpoolBump: number;
};

/**
 * @category Solana Accounts
 */
export type WhirlpoolData = {
  whirlpoolsConfig: PublicKey;
  whirlpoolBump: number[];
  feeRate: number;
  protocolFeeRate: number;
  liquidity: BN;
  sqrtPrice: BN;
  tickCurrentIndex: number;
  protocolFeeOwedA: BN;
  protocolFeeOwedB: BN;
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  feeGrowthGlobalA: BN;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  feeGrowthGlobalB: BN;
  rewardLastUpdatedTimestamp: BN;
  rewardInfos: WhirlpoolRewardInfoData[];
  tickSpacing: number;
  feeTierIndexSeed: number[];
};

/**
 * @category Solana Accounts
 */
export type TickArrayData = {
  whirlpool: PublicKey;
  startTickIndex: number;
  ticks: TickData[];
};

/**
 * @category Solana Accounts
 */
export type TickData = {
  initialized: boolean;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideA: BN;
  feeGrowthOutsideB: BN;
  rewardGrowthsOutside: BN[];
};

/**
 * @category Solana Accounts
 */
export type DynamicTickArrayData = {
  whirlpool: PublicKey;
  startTickIndex: number;
  tickBitmap: BN;
  ticks: DynamicTick[];
};

/**
 * @category Solana Accounts
 */
export type DynamicTick =
  | { uninitialized: object }
  | { initialized: [DynamicTickData] };

export const toTick = (tick: DynamicTick): TickData => {
  if ("uninitialized" in tick) {
    return {
      initialized: false,
      liquidityNet: new BN(0),
      liquidityGross: new BN(0),
      feeGrowthOutsideA: new BN(0),
      feeGrowthOutsideB: new BN(0),
      rewardGrowthsOutside: [new BN(0), new BN(0), new BN(0)],
    };
  }
  return {
    initialized: true,
    ...tick.initialized[0],
  };
};

/**
 * @category Solana Accounts
 */
export type DynamicTickData = {
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideA: BN;
  feeGrowthOutsideB: BN;
  rewardGrowthsOutside: BN[];
};

/**
 * @category Solana Accounts
 */
export type PositionRewardInfoData = {
  growthInsideCheckpoint: BN;
  amountOwed: BN;
};

/**
 * @category Solana Accounts
 */
export type OpenPositionBumpsData = {
  positionBump: number;
};

/**
 * @category Solana Accounts
 */
export type OpenPositionWithMetadataBumpsData = {
  positionBump: number;
  metadataBump: number;
};

/**
 * @category Solana Accounts
 */
export type PositionData = {
  whirlpool: PublicKey;
  positionMint: PublicKey;
  liquidity: BN;
  tickLowerIndex: number;
  tickUpperIndex: number;
  feeGrowthCheckpointA: BN;
  feeOwedA: BN;
  feeGrowthCheckpointB: BN;
  feeOwedB: BN;
  rewardInfos: PositionRewardInfoData[];
};

/**
 * @category Solana Accounts
 */
export type FeeTierData = {
  whirlpoolsConfig: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
};

/**
 * @category Solana Accounts
 */
export type PositionBundleData = {
  positionBundleMint: PublicKey;
  positionBitmap: number[];
};

/**
 * @category Solana Accounts
 */
export type WhirlpoolsConfigExtensionData = {
  whirlpoolsConfig: PublicKey;
  configExtensionAuthority: PublicKey;
  tokenBadgeAuthority: PublicKey;
};

/**
 * @category Solana Accounts
 */
export type TokenBadgeData = {
  whirlpoolsConfig: PublicKey;
  tokenMint: PublicKey;
};

/**
 * @category Solana Accounts
 */
export type LockTypeLabelData = { permanent: object };

/**
 * @category Solana Accounts
 */
export type LockTypeData = { permanent: object };

/**
 * @category Solana Accounts
 */
export type LockConfigData = {
  position: PublicKey;
  positionOwner: PublicKey;
  whirlpool: PublicKey;
  lockType: LockTypeLabelData;
  lockedTimestamp: BN;
};

/**
 * @category Solana Accounts
 */
export type AdaptiveFeeTierData = {
  whirlpoolsConfig: PublicKey;
  feeTierIndex: number;
  tickSpacing: number;
  initializePoolAuthority: PublicKey;
  delegatedFeeAuthority: PublicKey;
  defaultBaseFeeRate: number;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  adaptiveFeeControlFactor: number;
  maxVolatilityAccumulator: number;
  tickGroupSize: number;
  majorSwapThresholdTicks: number;
};

/**
 * @category Solana Accounts
 */
export type OracleData = {
  whirlpool: PublicKey;
  tradeEnableTimestamp: BN;
  adaptiveFeeConstants: AdaptiveFeeConstantsData;
  adaptiveFeeVariables: AdaptiveFeeVariablesData;
};

/**
 * @category Solana Accounts
 */
export type AdaptiveFeeConstantsData = {
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  adaptiveFeeControlFactor: number;
  maxVolatilityAccumulator: number;
  tickGroupSize: number;
  majorSwapThresholdTicks: number;
};

/**
 * @category Solana Accounts
 */
export type AdaptiveFeeVariablesData = {
  lastReferenceUpdateTimestamp: BN;
  lastMajorSwapTimestamp: BN;
  volatilityReference: number;
  tickGroupIndexReference: number;
  volatilityAccumulator: number;
};
