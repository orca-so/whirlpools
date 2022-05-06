import { MathUtil } from "@orca-so/common-sdk";
import { BN } from "@project-serum/anchor";
import invariant from "tiny-invariant";
import { NUM_REWARDS, PositionData, TickData, WhirlpoolData } from "../../types/public";
import { PoolUtil } from "../../utils/public/pool-utils";

/**
 * @category Quotes
 */
export type CollectRewardsQuoteParam = {
  whirlpool: WhirlpoolData;
  position: PositionData;
  tickLower: TickData;
  tickUpper: TickData;
};

/**
 * @category Quotes
 */
export type CollectRewardsQuote = [BN | undefined, BN | undefined, BN | undefined];

/**
 * Get a quote on the outstanding rewards owed to a position.
 *
 * @category Quotes
 * @param param A collection of fetched Whirlpool accounts to faciliate the quote.
 * @returns A quote object containing the rewards owed for each reward in the pool.
 */
export function collectRewardsQuote(param: CollectRewardsQuoteParam): CollectRewardsQuote {
  const { whirlpool, position, tickLower, tickUpper } = param;

  const { tickCurrentIndex, rewardInfos: whirlpoolRewardsInfos } = whirlpool;
  const { tickLowerIndex, tickUpperIndex, liquidity, rewardInfos } = position;

  // Calculate the reward growths inside the position

  const range = [...Array(NUM_REWARDS).keys()];
  const rewardGrowthsBelowX64: BN[] = range.map(() => new BN(0));
  const rewardGrowthsAboveX64: BN[] = range.map(() => new BN(0));

  for (const i of range) {
    const rewardInfo = whirlpoolRewardsInfos[i];
    invariant(!!rewardInfo, "whirlpoolRewardsInfos cannot be undefined");

    const growthGlobalX64 = rewardInfo.growthGlobalX64;
    const lowerRewardGrowthsOutside = tickLower.rewardGrowthsOutside[i];
    const upperRewardGrowthsOutside = tickUpper.rewardGrowthsOutside[i];
    invariant(!!lowerRewardGrowthsOutside, "lowerRewardGrowthsOutside cannot be undefined");
    invariant(!!upperRewardGrowthsOutside, "upperRewardGrowthsOutside cannot be undefined");

    if (tickCurrentIndex < tickLowerIndex) {
      rewardGrowthsBelowX64[i] = MathUtil.subUnderflowU128(
        growthGlobalX64,
        lowerRewardGrowthsOutside
      );
    } else {
      rewardGrowthsBelowX64[i] = lowerRewardGrowthsOutside;
    }

    if (tickCurrentIndex < tickUpperIndex) {
      rewardGrowthsAboveX64[i] = upperRewardGrowthsOutside;
    } else {
      rewardGrowthsAboveX64[i] = MathUtil.subUnderflowU128(
        growthGlobalX64,
        upperRewardGrowthsOutside
      );
    }
  }

  const rewardGrowthsInsideX64: [BN, boolean][] = range.map(() => [new BN(0), false]);

  for (const i of range) {
    const rewardInfo = whirlpoolRewardsInfos[i];
    invariant(!!rewardInfo, "whirlpoolRewardsInfos cannot be undefined");

    const isRewardInitialized = PoolUtil.isRewardInitialized(rewardInfo);

    if (isRewardInitialized) {
      const growthBelowX64 = rewardGrowthsBelowX64[i];
      const growthAboveX64 = rewardGrowthsAboveX64[i];
      invariant(!!growthBelowX64, "growthBelowX64 cannot be undefined");
      invariant(!!growthAboveX64, "growthAboveX64 cannot be undefined");

      const growthInsde = MathUtil.subUnderflowU128(
        MathUtil.subUnderflowU128(rewardInfo.growthGlobalX64, growthBelowX64),
        growthAboveX64
      );
      rewardGrowthsInsideX64[i] = [growthInsde, true];
    }
  }

  // Calculate the updated rewards owed

  const updatedRewardInfosX64: BN[] = range.map(() => new BN(0));

  for (const i of range) {
    const growthInsideX64 = rewardGrowthsInsideX64[i];
    invariant(!!growthInsideX64, "growthInsideX64 cannot be undefined");

    const [rewardGrowthInsideX64, isRewardInitialized] = growthInsideX64;

    if (isRewardInitialized) {
      const rewardInfo = rewardInfos[i];
      invariant(!!rewardInfo, "rewardInfo cannot be undefined");

      const amountOwedX64 = rewardInfo.amountOwed.shln(64);
      const growthInsideCheckpointX64 = rewardInfo.growthInsideCheckpoint;
      updatedRewardInfosX64[i] = amountOwedX64.add(
        MathUtil.subUnderflowU128(rewardGrowthInsideX64, growthInsideCheckpointX64).mul(liquidity)
      );
    }
  }

  invariant(rewardGrowthsInsideX64.length >= 3, "rewards length is less than 3");

  const rewardExistsA = rewardGrowthsInsideX64[0]?.[1];
  const rewardExistsB = rewardGrowthsInsideX64[1]?.[1];
  const rewardExistsC = rewardGrowthsInsideX64[2]?.[1];

  const rewardOwedA = rewardExistsA ? updatedRewardInfosX64[0]?.shrn(64) : undefined;
  const rewardOwedB = rewardExistsB ? updatedRewardInfosX64[1]?.shrn(64) : undefined;
  const rewardOwedC = rewardExistsC ? updatedRewardInfosX64[2]?.shrn(64) : undefined;

  return [rewardOwedA, rewardOwedB, rewardOwedC];
}
