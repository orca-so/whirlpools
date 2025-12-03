import { BN } from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import invariant from "tiny-invariant";
import type {
  DynamicTickData,
  PositionData,
  TickData,
  WhirlpoolData,
} from "../../types/public";
import { NUM_REWARDS } from "../../types/public";
import { BitMath } from "../../utils/math/bit-math";
import { PoolUtil } from "../../utils/public/pool-utils";
import type { TokenExtensionContextForReward } from "../../utils/public/token-extension-util";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";

/**
 * Parameters needed to generate a quote on collectible rewards on a position.
 * @category Quotes
 * @param whirlpool - the account data for the whirlpool this position belongs to
 * @param position - the account data for the position
 * @param tickLower - the TickData account for the lower bound of this position
 * @param tickUpper - the TickData account for the upper bound of this position
 * @param timeStampInSeconds - optional parameter to generate this quote to a unix time stamp.
 */
export type CollectRewardsQuoteParam = {
  whirlpool: WhirlpoolData;
  position: PositionData;
  tickLower: TickData | DynamicTickData;
  tickUpper: TickData | DynamicTickData;
  tokenExtensionCtx: TokenExtensionContextForReward;
  timeStampInSeconds?: BN;
};

/**
 * An array of reward amounts that is collectible on a position.
 * @category Quotes
 */
export type CollectRewardsQuote = {
  rewardOwed: [BN | undefined, BN | undefined, BN | undefined];
  transferFee: {
    deductedFromRewardOwed: [BN | undefined, BN | undefined, BN | undefined];
  };
};

/**
 * Get a quote on the outstanding rewards owed to a position.
 *
 * @category Quotes
 * @param param A collection of fetched Whirlpool accounts to faciliate the quote.
 * @returns A quote object containing the rewards owed for each reward in the pool.
 */
export function collectRewardsQuote(
  param: CollectRewardsQuoteParam,
): CollectRewardsQuote {
  const {
    whirlpool,
    position,
    tickLower,
    tickUpper,
    timeStampInSeconds,
    tokenExtensionCtx,
  } = param;

  const {
    tickCurrentIndex,
    rewardInfos: whirlpoolRewardsInfos,
    rewardLastUpdatedTimestamp,
  } = whirlpool;
  const {
    tickLowerIndex,
    tickUpperIndex,
    liquidity,
    rewardInfos: positionRewardInfos,
  } = position;

  const currTimestampInSeconds =
    timeStampInSeconds ?? new BN(Date.now()).div(new BN(1000));
  const timestampDelta = currTimestampInSeconds.sub(
    new BN(rewardLastUpdatedTimestamp),
  );
  const rewardOwed: [BN | undefined, BN | undefined, BN | undefined] = [
    undefined,
    undefined,
    undefined,
  ];
  const transferFee: [BN | undefined, BN | undefined, BN | undefined] = [
    undefined,
    undefined,
    undefined,
  ];

  for (let i = 0; i < NUM_REWARDS; i++) {
    // Calculate the reward growth on the outside of the position (growth_above, growth_below)
    const rewardInfo = whirlpoolRewardsInfos[i];
    const positionRewardInfo = positionRewardInfos[i];
    invariant(!!rewardInfo, "whirlpoolRewardsInfos cannot be undefined");

    const isRewardInitialized = PoolUtil.isRewardInitialized(rewardInfo);
    if (!isRewardInitialized) {
      continue;
    }

    // Increment the global reward growth tracker based on time elasped since the last whirlpool update.
    let adjustedRewardGrowthGlobalX64 = rewardInfo.growthGlobalX64;
    if (!whirlpool.liquidity.isZero()) {
      const rewardGrowthDelta = BitMath.mulDiv(
        timestampDelta,
        rewardInfo.emissionsPerSecondX64,
        whirlpool.liquidity,
        128,
      );
      adjustedRewardGrowthGlobalX64 =
        rewardInfo.growthGlobalX64.add(rewardGrowthDelta);
    }

    // Calculate the reward growth outside of the position
    const tickLowerRewardGrowthsOutsideX64 = tickLower.rewardGrowthsOutside[i];
    const tickUpperRewardGrowthsOutsideX64 = tickUpper.rewardGrowthsOutside[i];

    let rewardGrowthsBelowX64: BN = adjustedRewardGrowthGlobalX64;
    if (isTickInitialized(tickLower) || isDynamicTickData(tickLower)) {
      rewardGrowthsBelowX64 =
        tickCurrentIndex < tickLowerIndex
          ? MathUtil.subUnderflowU128(
              adjustedRewardGrowthGlobalX64,
              tickLowerRewardGrowthsOutsideX64,
            )
          : tickLowerRewardGrowthsOutsideX64;
    }

    let rewardGrowthsAboveX64: BN = new BN(0);
    if (isTickInitialized(tickUpper) || isDynamicTickData(tickUpper)) {
      rewardGrowthsAboveX64 =
        tickCurrentIndex < tickUpperIndex
          ? tickUpperRewardGrowthsOutsideX64
          : MathUtil.subUnderflowU128(
              adjustedRewardGrowthGlobalX64,
              tickUpperRewardGrowthsOutsideX64,
            );
    }

    const rewardGrowthInsideX64 = MathUtil.subUnderflowU128(
      MathUtil.subUnderflowU128(
        adjustedRewardGrowthGlobalX64,
        rewardGrowthsBelowX64,
      ),
      rewardGrowthsAboveX64,
    );

    // Knowing the growth of the reward checkpoint for the position, calculate and increment the amount owed for each reward.
    const amountOwedX64 = positionRewardInfo.amountOwed.shln(64);
    const amountOwed = amountOwedX64
      .add(
        MathUtil.subUnderflowU128(
          rewardGrowthInsideX64,
          positionRewardInfo.growthInsideCheckpoint,
        ).mul(liquidity),
      )
      .shrn(64);

    const transferFeeExcluded =
      TokenExtensionUtil.calculateTransferFeeExcludedAmount(
        amountOwed,
        tokenExtensionCtx.rewardTokenMintsWithProgram[i]!,
        tokenExtensionCtx.currentEpoch,
      );

    rewardOwed[i] = transferFeeExcluded.amount;
    transferFee[i] = transferFeeExcluded.fee;
  }

  return {
    rewardOwed,
    transferFee: {
      deductedFromRewardOwed: transferFee,
    },
  };
}

function isTickInitialized(tick: TickData | DynamicTickData): tick is TickData {
  return "initialized" in tick && tick.initialized;
}

function isDynamicTickData(
  tick: TickData | DynamicTickData,
): tick is DynamicTickData {
  return !("initialized" in tick);
}
