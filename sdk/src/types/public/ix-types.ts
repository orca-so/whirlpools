import { u64 } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PDA } from "./helper-types";

export type InitConfigParams = {
  whirlpoolConfigKeypair: Keypair;
  feeAuthority: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  defaultProtocolFeeRate: number;
  funder: PublicKey;
};

export type InitFeeTierParams = {
  feeTierPda: PDA;
  feeAuthority: PublicKey;
  whirlpoolConfigKey: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
  funder: PublicKey;
};

export type InitPoolParams = {
  initSqrtPrice: BN;
  whirlpoolConfigKey: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  whirlpoolPda: PDA;
  feeTierKey: PublicKey;
  tokenVaultAKeypair: Keypair;
  tokenVaultBKeypair: Keypair;
  tickSpacing: number;
  funder: PublicKey;
};

export type InitTickArrayParams = {
  whirlpool: PublicKey;
  tickArrayPda: PDA;
  startTick: number;
  funder: PublicKey;
};

export type InitializeRewardParams = {
  rewardAuthority: PublicKey;
  funder: PublicKey;
  whirlpool: PublicKey;
  rewardMint: PublicKey;
  rewardVaultKeypair: Keypair;
  rewardIndex: number;
};

export type SetRewardEmissionsParams = {
  rewardAuthority: PublicKey;
  whirlpool: PublicKey;
  rewardIndex: number;
  rewardVault: PublicKey;
  emissionsPerSecondX64: BN;
};

export type OpenPositionParams = {
  funder: PublicKey;
  ownerKey: PublicKey;
  positionPda: PDA;
  metadataPda?: PDA;
  positionMintAddress: PublicKey;
  positionTokenAccountAddress: PublicKey;
  whirlpoolKey: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
};

export type ClosePositionParams = {
  positionAuthority: PublicKey;
  receiver: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
};

export type IncreaseLiquidityParams = {
  liquidityAmount: BN;
  tokenMaxA: u64;
  tokenMaxB: u64;
  whirlpool: PublicKey;
  positionAuthority: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
};

export type DecreaseLiquidityParams = {
  liquidityAmount: BN;
  tokenMinA: u64;
  tokenMinB: u64;
  whirlpool: PublicKey;
  positionAuthority: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
};

export type UpdateFeesAndRewardsParams = {
  whirlpool: PublicKey;
  position: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
};

export type CollectFeesParams = {
  whirlpool: PublicKey;
  positionAuthority: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
};

export type CollectRewardParams = {
  whirlpool: PublicKey;
  positionAuthority: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  rewardOwnerAccount: PublicKey;
  rewardVault: PublicKey;
  rewardIndex: number;
};

export type CollectProtocolFeesParams = {
  whirlpoolsConfig: PublicKey;
  whirlpool: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenDestinationA: PublicKey;
  tokenDestinationB: PublicKey;
};

export type SwapParams = {
  amount: u64;
  otherAmountThreshold: u64;
  sqrtPriceLimit: BN;
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
  whirlpool: PublicKey;
  tokenAuthority: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenVaultA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultB: PublicKey;
  tickArray0: PublicKey;
  tickArray1: PublicKey;
  tickArray2: PublicKey;
  oracle: PublicKey;
};

export type SetRewardEmissionsSuperAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  newRewardEmissionsSuperAuthority: PublicKey;
};

export type SetRewardAuthorityParams = {
  whirlpool: PublicKey;
  rewardAuthority: PublicKey;
  newRewardAuthority: PublicKey;
  rewardIndex: number;
};

export type SetRewardAuthorityBySuperAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  whirlpool: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  newRewardAuthority: PublicKey;
  rewardIndex: number;
};

export type SetFeeAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  newFeeAuthority: PublicKey;
};

export type SetCollectProtocolFeesAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  newCollectProtocolFeesAuthority: PublicKey;
};

export type SetFeeRateParams = {
  whirlpool: PublicKey;
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  feeRate: number;
};

export type SetProtocolFeeRateParams = {
  whirlpool: PublicKey;
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  protocolFeeRate: number;
};

export type SetDefaultFeeRateParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
};

export type SetDefaultProtocolFeeRateParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  defaultProtocolFeeRate: number;
};
