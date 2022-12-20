import { BN, BorshAccountsCoder, Idl } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
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
 * @category Parsables
 */
export enum AccountName {
  WhirlpoolsConfig = "WhirlpoolsConfig",
  Position = "Position",
  TickArray = "TickArray",
  Whirlpool = "Whirlpool",
  FeeTier = "FeeTier",
}

const IDL = WhirlpoolIDL as Idl;

/**
 * The Anchor coder for the Whirlpool program.
 * @category Solana Accounts
 */
export const WHIRLPOOL_CODER = new BorshAccountsCoder(IDL);

/**
 * Size of the Whirlpool account in bytes.
 * @category Solana Accounts
 */
export const WHIRLPOOL_ACCOUNT_SIZE = WHIRLPOOL_CODER.size(IDL.accounts![4]);

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
