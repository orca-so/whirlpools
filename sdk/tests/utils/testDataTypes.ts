import { Keypair } from "@solana/web3.js";
import { BN } from "bn.js";
import { PriceMath } from "../../src";

export const testWhirlpoolData = {
  whirlpoolsConfig: Keypair.generate().publicKey,
  whirlpoolBump: [],
  feeRate: 300,
  protocolFeeRate: 1800,
  liquidity: new BN("32523523532"),
  sqrtPrice: new BN("32523523532"),
  tickCurrentIndex: PriceMath.sqrtPriceX64ToTickIndex(new BN("32523523532")),
  protocolFeeOwedA: new BN("2314532532"),
  protocolFeeOwedB: new BN("2314532532"),
  tokenMintA: Keypair.generate().publicKey,
  tokenVaultA: Keypair.generate().publicKey,
  feeGrowthGlobalA: new BN("32532523523523523"),
  tokenMintB: Keypair.generate().publicKey,
  tokenVaultB: Keypair.generate().publicKey,
  feeGrowthGlobalB: new BN("32532523523523523"),
  rewardLastUpdatedTimestamp: new BN("3253252312412523523523"),
  rewardInfos: [],
  tickSpacing: 64,
};
