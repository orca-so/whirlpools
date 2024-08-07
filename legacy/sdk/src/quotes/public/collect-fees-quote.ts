import type { BN } from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import type { PositionData, TickData, WhirlpoolData } from "../../types/public";
import type { TokenExtensionContextForPool } from "../../utils/public/token-extension-util";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";

/**
 * @category Quotes
 */
export type CollectFeesQuoteParam = {
  whirlpool: WhirlpoolData;
  position: PositionData;
  tickLower: TickData;
  tickUpper: TickData;
  tokenExtensionCtx: TokenExtensionContextForPool;
};

/**
 * @category Quotes
 */
export type CollectFeesQuote = {
  feeOwedA: BN;
  feeOwedB: BN;
  transferFee: {
    deductedFromFeeOwedA: BN;
    deductedFromFeeOwedB: BN;
  };
};

/**
 * Get a quote on the outstanding fees owed to a position.
 *
 * @category Quotes
 * @param param A collection of fetched Whirlpool accounts to faciliate the quote.
 * @returns A quote object containing the fees owed for each token in the pool.
 */
export function collectFeesQuote(
  param: CollectFeesQuoteParam,
): CollectFeesQuote {
  const { whirlpool, position, tickLower, tickUpper, tokenExtensionCtx } =
    param;

  const {
    tickCurrentIndex,
    feeGrowthGlobalA: feeGrowthGlobalAX64,
    feeGrowthGlobalB: feeGrowthGlobalBX64,
  } = whirlpool;
  const {
    tickLowerIndex,
    tickUpperIndex,
    liquidity,
    feeOwedA,
    feeOwedB,
    feeGrowthCheckpointA: feeGrowthCheckpointAX64,
    feeGrowthCheckpointB: feeGrowthCheckpointBX64,
  } = position;
  const {
    feeGrowthOutsideA: tickLowerFeeGrowthOutsideAX64,
    feeGrowthOutsideB: tickLowerFeeGrowthOutsideBX64,
  } = tickLower;
  const {
    feeGrowthOutsideA: tickUpperFeeGrowthOutsideAX64,
    feeGrowthOutsideB: tickUpperFeeGrowthOutsideBX64,
  } = tickUpper;

  // Calculate the fee growths inside the position

  let feeGrowthBelowAX64: BN | null = null;
  let feeGrowthBelowBX64: BN | null = null;

  if (tickCurrentIndex < tickLowerIndex) {
    feeGrowthBelowAX64 = MathUtil.subUnderflowU128(
      feeGrowthGlobalAX64,
      tickLowerFeeGrowthOutsideAX64,
    );
    feeGrowthBelowBX64 = MathUtil.subUnderflowU128(
      feeGrowthGlobalBX64,
      tickLowerFeeGrowthOutsideBX64,
    );
  } else {
    feeGrowthBelowAX64 = tickLowerFeeGrowthOutsideAX64;
    feeGrowthBelowBX64 = tickLowerFeeGrowthOutsideBX64;
  }

  let feeGrowthAboveAX64: BN | null = null;
  let feeGrowthAboveBX64: BN | null = null;

  if (tickCurrentIndex < tickUpperIndex) {
    feeGrowthAboveAX64 = tickUpperFeeGrowthOutsideAX64;
    feeGrowthAboveBX64 = tickUpperFeeGrowthOutsideBX64;
  } else {
    feeGrowthAboveAX64 = MathUtil.subUnderflowU128(
      feeGrowthGlobalAX64,
      tickUpperFeeGrowthOutsideAX64,
    );
    feeGrowthAboveBX64 = MathUtil.subUnderflowU128(
      feeGrowthGlobalBX64,
      tickUpperFeeGrowthOutsideBX64,
    );
  }

  const feeGrowthInsideAX64 = MathUtil.subUnderflowU128(
    MathUtil.subUnderflowU128(feeGrowthGlobalAX64, feeGrowthBelowAX64),
    feeGrowthAboveAX64,
  );
  const feeGrowthInsideBX64 = MathUtil.subUnderflowU128(
    MathUtil.subUnderflowU128(feeGrowthGlobalBX64, feeGrowthBelowBX64),
    feeGrowthAboveBX64,
  );

  // Calculate the updated fees owed
  const feeOwedADelta = MathUtil.subUnderflowU128(
    feeGrowthInsideAX64,
    feeGrowthCheckpointAX64,
  )
    .mul(liquidity)
    .shrn(64);
  const feeOwedBDelta = MathUtil.subUnderflowU128(
    feeGrowthInsideBX64,
    feeGrowthCheckpointBX64,
  )
    .mul(liquidity)
    .shrn(64);

  const updatedFeeOwedA = feeOwedA.add(feeOwedADelta);
  const transferFeeExcludedAmountA =
    TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      updatedFeeOwedA,
      tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtx.currentEpoch,
    );

  const updatedFeeOwedB = feeOwedB.add(feeOwedBDelta);
  const transferFeeExcludedAmountB =
    TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      updatedFeeOwedB,
      tokenExtensionCtx.tokenMintWithProgramB,
      tokenExtensionCtx.currentEpoch,
    );

  return {
    feeOwedA: transferFeeExcludedAmountA.amount,
    feeOwedB: transferFeeExcludedAmountB.amount,
    transferFee: {
      deductedFromFeeOwedA: transferFeeExcludedAmountA.fee,
      deductedFromFeeOwedB: transferFeeExcludedAmountB.fee,
    },
  };
}
