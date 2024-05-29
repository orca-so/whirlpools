import { BN } from "@coral-xyz/anchor";
import { Percentage, ZERO } from "@orca-so/common-sdk";
import invariant from "tiny-invariant";
import { DecreaseLiquidityInput } from "../../instructions";
import {
  PositionStatus,
  PositionUtil,
  adjustForSlippage,
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
} from "../../utils/position-util";
import { PriceMath, TickUtil } from "../../utils/public";
import { TokenExtensionContextForPool, TokenExtensionUtil } from "../../utils/public/token-extension-util";
import { Position, Whirlpool } from "../../whirlpool-client";

/**
 * @category Quotes
 * @param liquidity - The desired liquidity to withdraw from the Whirlpool
 * @param tickCurrentIndex - The Whirlpool's current tickIndex
 * @param sqrtPrice - The Whirlpool's current sqrtPrice
 * @param tickLowerIndex - The lower index of the position that we are withdrawing from.
 * @param tickUpperIndex - The upper index of the position that we are withdrawing from.
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 */
export type DecreaseLiquidityQuoteParam = {
  liquidity: BN;
  tickCurrentIndex: number;
  sqrtPrice: BN;
  tickLowerIndex: number;
  tickUpperIndex: number;
  tokenExtensionCtx: TokenExtensionContextForPool;
  slippageTolerance: Percentage;
};

/**
 * Return object from decrease liquidity quote functions.
 * @category Quotes
 */
export type DecreaseLiquidityQuote = DecreaseLiquidityInput & {
  tokenEstA: BN;
  tokenEstB: BN;
  transferFee: {
    deductedFromTokenEstA: BN;
    deductedFromTokenEstB: BN;
    deductedFromTokenMinA: BN;
    deductedFromTokenMinB: BN;
  };
};

/**
 * Get an estimated quote on the minimum tokens receivable based on the desired withdraw liquidity value.
 *
 * @category Quotes
 * @param liquidity - The desired liquidity to withdraw from the Whirlpool
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 * @param position - A Position helper class to help interact with the Position account.
 * @param whirlpool - A Whirlpool helper class to help interact with the Whirlpool account.
 * @returns An DecreaseLiquidityQuote object detailing the tokenMin & liquidity values to use when calling decrease-liquidity-ix.
 */
export function decreaseLiquidityQuoteByLiquidity(
  liquidity: BN,
  slippageTolerance: Percentage,
  position: Position,
  whirlpool: Whirlpool,
  tokenExtensionCtx: TokenExtensionContextForPool,
) {
  const positionData = position.getData();
  const whirlpoolData = whirlpool.getData();

  invariant(
    liquidity.lte(positionData.liquidity),
    "Quote liquidity is more than the position liquidity."
  );

  return decreaseLiquidityQuoteByLiquidityWithParams({
    liquidity,
    slippageTolerance,
    tickLowerIndex: positionData.tickLowerIndex,
    tickUpperIndex: positionData.tickUpperIndex,
    sqrtPrice: whirlpoolData.sqrtPrice,
    tickCurrentIndex: whirlpoolData.tickCurrentIndex,
    tokenExtensionCtx,
  });
}

/**
 * Get an estimated quote on the minimum tokens receivable based on the desired withdraw liquidity value.
 *
 * @category Quotes
 * @param param DecreaseLiquidityQuoteParam
 * @returns An DecreaseLiquidityInput object detailing the tokenMin & liquidity values to use when calling decrease-liquidity-ix.
 */
export function decreaseLiquidityQuoteByLiquidityWithParams(
  params: DecreaseLiquidityQuoteParam
): DecreaseLiquidityQuote {
  invariant(TickUtil.checkTickInBounds(params.tickLowerIndex), "tickLowerIndex is out of bounds.");
  invariant(TickUtil.checkTickInBounds(params.tickUpperIndex), "tickUpperIndex is out of bounds.");
  invariant(
    TickUtil.checkTickInBounds(params.tickCurrentIndex),
    "tickCurrentIndex is out of bounds."
  );

  if (params.liquidity.eq(ZERO)) {
    return {
      tokenMinA: ZERO,
      tokenMinB: ZERO,
      liquidityAmount: ZERO,
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      transferFee: {
        deductedFromTokenMinA: ZERO,
        deductedFromTokenMinB: ZERO,
        deductedFromTokenEstA: ZERO,
        deductedFromTokenEstB: ZERO,
      },
    };
  }

  const { tokenExtensionCtx } = params;
  const { tokenEstA, tokenEstB } = getTokenEstimatesFromLiquidity(params);
  const [tokenMinA, tokenMinB] = [tokenEstA, tokenEstB].map((tokenEst) => adjustForSlippage(tokenEst, params.slippageTolerance, false));

  const tokenMinAExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenMinA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenEstAExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenEstA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenMinBExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenMinB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);
  const tokenEstBExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenEstB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);

  return {
    tokenMinA: tokenMinAExcluded.amount,
    tokenMinB: tokenMinBExcluded.amount,
    tokenEstA: tokenEstAExcluded.amount,
    tokenEstB: tokenEstBExcluded.amount,
    liquidityAmount: params.liquidity,
    transferFee: {
      deductedFromTokenMinA: tokenMinAExcluded.fee,
      deductedFromTokenMinB: tokenMinBExcluded.fee,
      deductedFromTokenEstA: tokenEstAExcluded.fee,
      deductedFromTokenEstB: tokenEstBExcluded.fee,
    },
  };
}

/**
 * Get an estimated quote on the minimum tokens receivable based on the desired withdraw liquidity value.
 * This version calculates slippage based on price percentage movement, rather than setting the percentage threshold based on token estimates.
 * @param params DecreaseLiquidityQuoteParam
 * @returns A DecreaseLiquidityQuote object detailing the tokenMin & liquidity values to use when calling decrease-liquidity-ix.
 */
export function decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage(params: DecreaseLiquidityQuoteParam): DecreaseLiquidityQuote {
  const { tokenExtensionCtx } = params;
  if (params.liquidity.eq(ZERO)) {
    return {
      tokenMinA: ZERO,
      tokenMinB: ZERO,
      liquidityAmount: ZERO,
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      transferFee: {
        deductedFromTokenMinA: ZERO,
        deductedFromTokenMinB: ZERO,
        deductedFromTokenEstA: ZERO,
        deductedFromTokenEstB: ZERO,
      },
    };
  }

  const { tokenEstA, tokenEstB } = getTokenEstimatesFromLiquidity(params);

  const {
    lowerBound: [sLowerSqrtPrice, sLowerIndex],
    upperBound: [sUpperSqrtPrice, sUpperIndex],
  } = PriceMath.getSlippageBoundForSqrtPrice(params.sqrtPrice, params.slippageTolerance);

  const { tokenEstA: tokenEstALower, tokenEstB: tokenEstBLower } = getTokenEstimatesFromLiquidity({
    ...params,
    sqrtPrice: sLowerSqrtPrice,
    tickCurrentIndex: sLowerIndex,
  });

  const { tokenEstA: tokenEstAUpper, tokenEstB: tokenEstBUpper } = getTokenEstimatesFromLiquidity({
    ...params,
    sqrtPrice: sUpperSqrtPrice,
    tickCurrentIndex: sUpperIndex,
  });

  const tokenMinA = BN.min(BN.min(tokenEstA, tokenEstALower), tokenEstAUpper);
  const tokenMinB = BN.min(BN.min(tokenEstB, tokenEstBLower), tokenEstBUpper);

  const tokenMinAExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenMinA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenEstAExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenEstA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenMinBExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenMinB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);
  const tokenEstBExcluded = TokenExtensionUtil.calculateTransferFeeExcludedAmount(tokenEstB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);

  return {
    tokenMinA: tokenMinAExcluded.amount,
    tokenMinB: tokenMinBExcluded.amount,
    tokenEstA: tokenEstAExcluded.amount,
    tokenEstB: tokenEstBExcluded.amount,
    liquidityAmount: params.liquidity,
    transferFee: {
      deductedFromTokenMinA: tokenMinAExcluded.fee,
      deductedFromTokenMinB: tokenMinBExcluded.fee,
      deductedFromTokenEstA: tokenEstAExcluded.fee,
      deductedFromTokenEstB: tokenEstBExcluded.fee,
    },
  }
}

function getTokenEstimatesFromLiquidity(params: DecreaseLiquidityQuoteParam) {
  const { liquidity, tickLowerIndex, tickUpperIndex, sqrtPrice } = params;

  if (liquidity.eq(ZERO)) {
    throw new Error("liquidity must be greater than 0");
  }

  let tokenEstA = ZERO;
  let tokenEstB = ZERO;

  const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);
  const positionStatus = PositionUtil.getStrictPositionStatus(sqrtPrice, tickLowerIndex, tickUpperIndex);

  if (positionStatus === PositionStatus.BelowRange) {
    tokenEstA = getTokenAFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, false);
  } else if (positionStatus === PositionStatus.InRange) {
    tokenEstA = getTokenAFromLiquidity(liquidity, sqrtPrice, upperSqrtPrice, false);
    tokenEstB = getTokenBFromLiquidity(liquidity, lowerSqrtPrice, sqrtPrice, false);
  } else {
    tokenEstB = getTokenBFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, false);
  }
  return { tokenEstA, tokenEstB };
}
