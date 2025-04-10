import { ZERO } from "@orca-so/common-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import invariant from "tiny-invariant";
import type {
  PositionBundleData,
  TickArray,
  TickArrayData,
  TickData,
  WhirlpoolContext,
} from "../../src";
import {
  PDAUtil,
  POSITION_BUNDLE_SIZE,
  PriceMath,
  TICK_ARRAY_SIZE,
} from "../../src";
import type { WhirlpoolAccountFetcherInterface } from "../../src/network/public/fetcher";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";

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
  feeTierIndexSeed: [64, 0],
};

export const testInitializedTickData: TickData = {
  feeGrowthOutsideA: ZERO,
  feeGrowthOutsideB: ZERO,
  initialized: true,
  liquidityGross: ZERO,
  liquidityNet: ZERO,
  rewardGrowthsOutside: [ZERO, ZERO],
};

export const testUninitializedTickData: TickData = {
  feeGrowthOutsideA: ZERO,
  feeGrowthOutsideB: ZERO,
  liquidityGross: ZERO,
  liquidityNet: ZERO,
  initialized: false,
  rewardGrowthsOutside: [ZERO, ZERO],
};

export const testTickArrayData: TickArrayData = {
  startTickIndex: 0,
  ticks: Array(TICK_ARRAY_SIZE).fill(testUninitializedTickData),
  whirlpool: PublicKey.default,
};

export const buildTickArrayData = (
  startTick: number,
  initializedOffsets: number[],
): TickArray => {
  const result = {
    ticks: Array(TICK_ARRAY_SIZE).fill(testUninitializedTickData),
    whirlpool: PublicKey.default,
    startTickIndex: startTick,
  };

  initializedOffsets.forEach((offset) => {
    if (offset >= TICK_ARRAY_SIZE) {
      throw new Error(
        `Cannot build tick-array with initialized offset - ${offset}`,
      );
    }
    result.ticks[offset] = testInitializedTickData;
  });
  const randomAddr = Keypair.generate().publicKey;
  return { address: randomAddr, startTickIndex: startTick, data: result };
};

export async function getTickArrays(
  startIndices: number[],
  ctx: WhirlpoolContext,
  whirlpoolKey: PublicKey,
  fetcher: WhirlpoolAccountFetcherInterface,
): Promise<TickArray[]> {
  const tickArrayPdas = startIndices.map((value) =>
    PDAUtil.getTickArray(ctx.program.programId, whirlpoolKey, value),
  );
  const tickArrayAddresses = tickArrayPdas.map((pda) => pda.publicKey);
  const tickArrays = await fetcher.getTickArrays(
    tickArrayAddresses,
    IGNORE_CACHE,
  );
  return tickArrayAddresses.map((addr, index) => {
    return {
      address: addr,
      startTickIndex: startIndices[index],
      data: tickArrays[index],
    };
  });
}

export const buildPositionBundleData = (
  occupiedBundleIndexes: number[],
): PositionBundleData => {
  invariant(
    POSITION_BUNDLE_SIZE % 8 == 0,
    "POSITION_BUNDLE_SIZE should be multiple of 8",
  );

  const positionBundleMint = Keypair.generate().publicKey;
  const positionBitmap: number[] = new Array(POSITION_BUNDLE_SIZE / 8).fill(0);
  occupiedBundleIndexes.forEach((bundleIndex) => {
    const index = Math.floor(bundleIndex / 8);
    const offset = bundleIndex % 8;
    positionBitmap[index] = positionBitmap[index] | (1 << offset);
  });
  return { positionBundleMint, positionBitmap };
};
