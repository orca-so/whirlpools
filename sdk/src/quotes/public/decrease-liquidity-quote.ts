import { BN } from "@coral-xyz/anchor";
import { Percentage, ZERO } from "@orca-so/common-sdk";
import invariant from "tiny-invariant";
import { DecreaseLiquidityInput } from "../../instructions";
import {
  adjustForSlippage,
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
  PositionStatus,
  PositionUtil,
} from "../../utils/position-util";
import { PriceMath, TickUtil } from "../../utils/public";
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
  slippageTolerance: Percentage;
};

/**
 * Return object from decrease liquidity quote functions.
 * @category Quotes
 */
export type DecreaseLiquidityQuote = DecreaseLiquidityInput & { tokenEstA: BN; tokenEstB: BN };

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
  whirlpool: Whirlpool
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
  param: DecreaseLiquidityQuoteParam
): DecreaseLiquidityQuote {
  invariant(TickUtil.checkTickInBounds(param.tickLowerIndex), "tickLowerIndex is out of bounds.");
  invariant(TickUtil.checkTickInBounds(param.tickUpperIndex), "tickUpperIndex is out of bounds.");
  invariant(
    TickUtil.checkTickInBounds(param.tickCurrentIndex),
    "tickCurrentIndex is out of bounds."
  );

  const positionStatus = PositionUtil.getPositionStatus(
    param.tickCurrentIndex,
    param.tickLowerIndex,
    param.tickUpperIndex
  );

  switch (positionStatus) {
    case PositionStatus.BelowRange:
      return quotePositionBelowRange(param);
    case PositionStatus.InRange:
      return quotePositionInRange(param);
    case PositionStatus.AboveRange:
      return quotePositionAboveRange(param);
    default:
      throw new Error(`type ${positionStatus} is an unknown PositionStatus`);
  }
}

function quotePositionBelowRange(param: DecreaseLiquidityQuoteParam): DecreaseLiquidityQuote {
  const { tickLowerIndex, tickUpperIndex, liquidity, slippageTolerance } = param;

  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const tokenEstA = getTokenAFromLiquidity(liquidity, sqrtPriceLowerX64, sqrtPriceUpperX64, false);
  const tokenMinA = adjustForSlippage(tokenEstA, slippageTolerance, false);

  return {
    tokenMinA,
    tokenMinB: ZERO,
    tokenEstA,
    tokenEstB: ZERO,
    liquidityAmount: liquidity,
  };
}

function quotePositionInRange(param: DecreaseLiquidityQuoteParam): DecreaseLiquidityQuote {
  const { sqrtPrice, tickLowerIndex, tickUpperIndex, liquidity, slippageTolerance } = param;

  const sqrtPriceX64 = sqrtPrice;
  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const tokenEstA = getTokenAFromLiquidity(liquidity, sqrtPriceX64, sqrtPriceUpperX64, false);
  const tokenMinA = adjustForSlippage(tokenEstA, slippageTolerance, false);
  const tokenEstB = getTokenBFromLiquidity(liquidity, sqrtPriceLowerX64, sqrtPriceX64, false);
  const tokenMinB = adjustForSlippage(tokenEstB, slippageTolerance, false);

  return {
    tokenMinA,
    tokenMinB,
    tokenEstA,
    tokenEstB,
    liquidityAmount: liquidity,
  };
}

function quotePositionAboveRange(param: DecreaseLiquidityQuoteParam): DecreaseLiquidityQuote {
  const { tickLowerIndex, tickUpperIndex, liquidity, slippageTolerance: slippageTolerance } = param;

  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const tokenEstB = getTokenBFromLiquidity(liquidity, sqrtPriceLowerX64, sqrtPriceUpperX64, false);
  const tokenMinB = adjustForSlippage(tokenEstB, slippageTolerance, false);

  return {
    tokenMinA: ZERO,
    tokenMinB,
    tokenEstA: ZERO,
    tokenEstB,
    liquidityAmount: liquidity,
  };
}
