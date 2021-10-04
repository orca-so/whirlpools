import { BN } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * This file contains the types that has the same structure as the types anchor functions returns.
 * These types are hard-casted by the client function.
 *
 * This file must be manually updated every time the idl updates as accounts will
 * be hard-casted to fit the type.
 */

export enum AccountName {
  WhirlpoolsConfig = "WhirlpoolsConfig",
  Position = "Position",
  TickArray = "TickArray",
  Whirlpool = "Whirlpool",
}

export type TickSpacingData = {
  stable?: {};
  standard?: {};
};

export type WhirlpoolRewardInfoData = {
  mint: PublicKey;
  vault: PublicKey;
  authority: PublicKey;
  emissionsPerSecondX64: BN;
  growthGlobalX64: BN;
};

export type WhirlpoolBumpsData = {
  whirlpoolBump: number;
};

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
};

export type TickArrayData = {
  whirlpool: PublicKey;
  startTickIndex: number;
  ticks: TickData[];
};

export type TickData = {
  initialized: boolean;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideA: BN;
  feeGrowthOutsideB: BN;
  rewardGrowthsOutside: BN[];
};

export type PositionRewardInfoData = {
  growthInsideCheckpoint: BN;
  amountOwed: BN;
};

export type OpenPositionBumpsData = {
  positionBump: number;
};

export type OpenPositionWithMetadataBumpsData = {
  positionBump: number;
  metadataBump: number;
};

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

export type FeeTierData = {
  whirlpoolsConfig: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
};
