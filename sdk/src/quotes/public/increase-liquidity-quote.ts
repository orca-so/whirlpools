import { Address } from "@coral-xyz/anchor";
import { AddressUtil, DecimalUtil, Percentage, ZERO } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import invariant from "tiny-invariant";
import { IncreaseLiquidityInput } from "../../instructions";
import {
  PositionStatus,
  PositionUtil,
  adjustForSlippage,
  getLiquidityFromTokenA,
  getLiquidityFromTokenB,
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
} from "../../utils/position-util";
import { PriceMath, TickUtil } from "../../utils/public";
import { Whirlpool } from "../../whirlpool-client";

/**
 * @category Quotes
 * @param inputTokenAmount - The amount of input tokens to deposit.
 * @param inputTokenMint - The mint of the input token the user would like to deposit.
 * @param tokenMintA - The mint of tokenA in the Whirlpool the user is depositing into.
 * @param tokenMintB -The mint of tokenB in the Whirlpool the user is depositing into.
 * @param tickCurrentIndex - The Whirlpool's current tickIndex
 * @param sqrtPrice - The Whirlpool's current sqrtPrice
 * @param tickLowerIndex - The lower index of the position that we are withdrawing from.
 * @param tickUpperIndex - The upper index of the position that we are withdrawing from.
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 */
export type IncreaseLiquidityQuoteParam = {
  inputTokenAmount: BN;
  inputTokenMint: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tickCurrentIndex: number;
  sqrtPrice: BN;
  tickLowerIndex: number;
  tickUpperIndex: number;
  slippageTolerance: Percentage;
};

/**
 * Return object from increase liquidity quote functions.
 * @category Quotes
 */
export type IncreaseLiquidityQuote = IncreaseLiquidityInput & IncreaseLiquidityEstimate;
type IncreaseLiquidityEstimate = { liquidityAmount: BN; tokenEstA: BN; tokenEstB: BN };

/**
 * Get an estimated quote on the maximum tokens required to deposit based on a specified input token amount.
 * This new version calculates slippage based on price percentage movement, rather than setting the percentage threshold based on token estimates.
 *
 * @category Quotes
 * @param inputTokenAmount - The amount of input tokens to deposit.
 * @param inputTokenMint - The mint of the input token the user would like to deposit.
 * @param tickLower - The lower index of the position that we are withdrawing from.
 * @param tickUpper - The upper index of the position that we are withdrawing from.
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 * @param whirlpool - A Whirlpool helper class to help interact with the Whirlpool account.
 * @returns An IncreaseLiquidityInput object detailing the required token amounts & liquidity values to use when calling increase-liquidity-ix.
 */
export function increaseLiquidityQuoteByInputToken_PriceSlippage(
  inputTokenMint: Address,
  inputTokenAmount: Decimal,
  tickLower: number,
  tickUpper: number,
  slippageTolerance: Percentage,
  whirlpool: Whirlpool
) {
  const data = whirlpool.getData();
  const tokenAInfo = whirlpool.getTokenAInfo();
  const tokenBInfo = whirlpool.getTokenBInfo();

  const inputMint = AddressUtil.toPubKey(inputTokenMint);
  const inputTokenInfo = inputMint.equals(tokenAInfo.mint) ? tokenAInfo : tokenBInfo;

  return increaseLiquidityQuoteByInputTokenWithParams_PriceSlippage({
    inputTokenMint: inputMint,
    inputTokenAmount: DecimalUtil.toBN(inputTokenAmount, inputTokenInfo.decimals),
    tickLowerIndex: TickUtil.getInitializableTickIndex(tickLower, data.tickSpacing),
    tickUpperIndex: TickUtil.getInitializableTickIndex(tickUpper, data.tickSpacing),
    slippageTolerance,
    ...data,
  });
}

/**
 * Get an estimated quote on the maximum tokens required to deposit based on a specified input token amount.
 * This new version calculates slippage based on price percentage movement, rather than setting the percentage threshold based on token estimates.
 * 
 * @category Quotes
 * @param param IncreaseLiquidityQuoteParam
 * @returns An IncreaseLiquidityInput object detailing the required token amounts & liquidity values to use when calling increase-liquidity-ix.
 */
export function increaseLiquidityQuoteByInputTokenWithParams_PriceSlippage(
  param: IncreaseLiquidityQuoteParam
): IncreaseLiquidityQuote {
  invariant(TickUtil.checkTickInBounds(param.tickLowerIndex), "tickLowerIndex is out of bounds.");
  invariant(TickUtil.checkTickInBounds(param.tickUpperIndex), "tickUpperIndex is out of bounds.");
  invariant(
    param.inputTokenMint.equals(param.tokenMintA) || param.inputTokenMint.equals(param.tokenMintB),
    `input token mint ${param.inputTokenMint.toBase58()} does not match any tokens in the provided pool.`
  );

  const {
    adjustedSqrtPrice: lowerAdjustedSqrtPrice,
    adjustedTickCurrentIndex: lowerAdjustedTickCurrentIndex,
  } = adjustPriceForSlippage(param.sqrtPrice, param.slippageTolerance, true);
  const {
    adjustedSqrtPrice: upperAdjustedSqrtPrice,
    adjustedTickCurrentIndex: upperAdjustedTickCurrentIndex,
  } = adjustPriceForSlippage(param.sqrtPrice, param.slippageTolerance, false);

  const lowerQuote = getQuoteByInputToken({
    ...param,
    sqrtPrice: lowerAdjustedSqrtPrice,
    tickCurrentIndex: lowerAdjustedTickCurrentIndex,
  });
  const quote = getQuoteByInputToken(param);
  const upperQuote = getQuoteByInputToken({
    ...param,
    sqrtPrice: upperAdjustedSqrtPrice,
    tickCurrentIndex: upperAdjustedTickCurrentIndex,
  });

  return {
    tokenMaxA: BN.max(BN.max(lowerQuote.tokenEstA, upperQuote.tokenEstA), quote.tokenEstA),
    tokenMaxB: BN.max(BN.max(lowerQuote.tokenEstB, upperQuote.tokenEstB), quote.tokenEstB),
    tokenEstA: quote.tokenEstA,
    tokenEstB: quote.tokenEstB,
    liquidityAmount: quote.liquidityAmount,
  };
}

function getQuoteByInputToken(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityEstimate {
  const positionStatus = PositionUtil.getStrictPositionStatus(
    param.sqrtPrice,
    param.tickLowerIndex,
    param.tickUpperIndex
  );

  switch (positionStatus) {
    case PositionStatus.BelowRange:
      return getQuotePositionBelowRange(param);
    case PositionStatus.InRange:
      return getQuotePositionInRange(param);
    case PositionStatus.AboveRange:
      return getQuotePositionAboveRange(param);
    default:
      throw new Error(`type ${positionStatus} is an unknown PositionStatus`);
  }
}

function adjustPriceForSlippage(
  sqrtPrice: BN,
  slippageTolerance: Percentage,
  lowerBound: boolean
): { adjustedSqrtPrice: BN; adjustedTickCurrentIndex: number } {
  if (lowerBound) {
    const adjustedSqrtPrice = sqrtPrice
      .mul(slippageTolerance.denominator.sub(slippageTolerance.numerator))
      .div(slippageTolerance.denominator);
    const adjustedTickCurrentIndex = PriceMath.sqrtPriceX64ToTickIndex(adjustedSqrtPrice);
    return { adjustedSqrtPrice, adjustedTickCurrentIndex };
  }

  const adjustedSqrtPrice = sqrtPrice
    .mul(slippageTolerance.denominator.add(slippageTolerance.numerator))
    .div(slippageTolerance.denominator);
  const adjustedTickCurrentIndex = PriceMath.sqrtPriceX64ToTickIndex(adjustedSqrtPrice);
  return { adjustedSqrtPrice, adjustedTickCurrentIndex };
}

function getQuotePositionBelowRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityEstimate {
  const { tokenMintA, inputTokenMint, inputTokenAmount, tickLowerIndex, tickUpperIndex } = param;

  if (!tokenMintA.equals(inputTokenMint)) {
    return {
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      liquidityAmount: ZERO,
    };
  }

  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const liquidityAmount = getLiquidityFromTokenA(
    inputTokenAmount,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    false
  );

  const tokenEstA = getTokenAFromLiquidity(
    liquidityAmount,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    true
  );

  return {
    tokenEstA,
    tokenEstB: ZERO,
    liquidityAmount,
  };
}

function getQuotePositionAboveRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityEstimate {
  const { tokenMintB, inputTokenMint, inputTokenAmount, tickLowerIndex, tickUpperIndex } = param;

  if (!tokenMintB.equals(inputTokenMint)) {
    return {
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      liquidityAmount: ZERO,
    };
  }

  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);
  const liquidityAmount = getLiquidityFromTokenB(
    inputTokenAmount,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    false
  );

  const tokenEstB = getTokenBFromLiquidity(
    liquidityAmount,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    true
  );

  return {
    tokenEstA: ZERO,
    tokenEstB,
    liquidityAmount,
  };
}

function getQuotePositionInRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityEstimate {
  const {
    tokenMintA,
    sqrtPrice,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
  } = param;

  const sqrtPriceX64 = sqrtPrice;
  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  let [tokenEstA, tokenEstB] = tokenMintA.equals(inputTokenMint)
    ? [inputTokenAmount, undefined]
    : [undefined, inputTokenAmount];

  let liquidityAmount: BN;

  if (tokenEstA) {
    liquidityAmount = getLiquidityFromTokenA(tokenEstA, sqrtPriceX64, sqrtPriceUpperX64, false);
    tokenEstA = getTokenAFromLiquidity(liquidityAmount, sqrtPriceX64, sqrtPriceUpperX64, true);
    tokenEstB = getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceX64, true);
  } else if (tokenEstB) {
    liquidityAmount = getLiquidityFromTokenB(tokenEstB, sqrtPriceLowerX64, sqrtPriceX64, false);
    tokenEstA = getTokenAFromLiquidity(liquidityAmount, sqrtPriceX64, sqrtPriceUpperX64, true);
    tokenEstB = getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceX64, true);
  } else {
    throw new Error("invariant violation");
  }

  return {
    tokenEstA,
    tokenEstB,
    liquidityAmount,
  };
}

/*** Deprecated ***/

/**
 * Get an estimated quote on the maximum tokens required to deposit based on a specified input token amount.
 *
 * @category Quotes
 * @param inputTokenAmount - The amount of input tokens to deposit.
 * @param inputTokenMint - The mint of the input token the user would like to deposit.
 * @param tickLower - The lower index of the position that we are withdrawing from.
 * @param tickUpper - The upper index of the position that we are withdrawing from.
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 * @param whirlpool - A Whirlpool helper class to help interact with the Whirlpool account.
 * @returns An IncreaseLiquidityInput object detailing the required token amounts & liquidity values to use when calling increase-liquidity-ix.
 * @deprecated Use increaseLiquidityQuoteByInputToken_PriceSlippage instead.
 */
export function increaseLiquidityQuoteByInputToken(
  inputTokenMint: Address,
  inputTokenAmount: Decimal,
  tickLower: number,
  tickUpper: number,
  slippageTolerance: Percentage,
  whirlpool: Whirlpool
) {
  const data = whirlpool.getData();
  const tokenAInfo = whirlpool.getTokenAInfo();
  const tokenBInfo = whirlpool.getTokenBInfo();

  const inputMint = AddressUtil.toPubKey(inputTokenMint);
  const inputTokenInfo = inputMint.equals(tokenAInfo.mint) ? tokenAInfo : tokenBInfo;

  return increaseLiquidityQuoteByInputTokenWithParams({
    inputTokenMint: inputMint,
    inputTokenAmount: DecimalUtil.toBN(inputTokenAmount, inputTokenInfo.decimals),
    tickLowerIndex: TickUtil.getInitializableTickIndex(tickLower, data.tickSpacing),
    tickUpperIndex: TickUtil.getInitializableTickIndex(tickUpper, data.tickSpacing),
    slippageTolerance,
    ...data,
  });
}

/**
 * Get an estimated quote on the maximum tokens required to deposit based on a specified input token amount.
 *
 * @category Quotes
 * @param param IncreaseLiquidityQuoteParam
 * @returns An IncreaseLiquidityInput object detailing the required token amounts & liquidity values to use when calling increase-liquidity-ix.
 * @deprecated Use increaseLiquidityQuoteByInputTokenWithParams_PriceSlippage instead.
 */
export function increaseLiquidityQuoteByInputTokenWithParams(
  param: IncreaseLiquidityQuoteParam
): IncreaseLiquidityQuote {
  invariant(TickUtil.checkTickInBounds(param.tickLowerIndex), "tickLowerIndex is out of bounds.");
  invariant(TickUtil.checkTickInBounds(param.tickUpperIndex), "tickUpperIndex is out of bounds.");
  invariant(
    param.inputTokenMint.equals(param.tokenMintA) || param.inputTokenMint.equals(param.tokenMintB),
    `input token mint ${param.inputTokenMint.toBase58()} does not match any tokens in the provided pool.`
  );

  const positionStatus = PositionUtil.getStrictPositionStatus(
    param.sqrtPrice,
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

/**
 * @deprecated
 */
function quotePositionBelowRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityQuote {
  const { slippageTolerance } = param;
  const quote = getQuotePositionBelowRange(param);

  return {
    tokenMaxA: adjustForSlippage(quote.tokenEstA, slippageTolerance, true),
    tokenMaxB: ZERO,
    ...quote,
  };
}

/**
 * @deprecated
 */
function quotePositionInRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityQuote {
  const { slippageTolerance } = param;

  const quote = getQuotePositionInRange(param);

  const tokenMaxA = adjustForSlippage(quote.tokenEstA, slippageTolerance, true);
  const tokenMaxB = adjustForSlippage(quote.tokenEstB, slippageTolerance, true);

  return {
    tokenMaxA,
    tokenMaxB,
    ...quote,
  };
}

/**
 * @deprecated
 */
function quotePositionAboveRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityQuote {
  const { slippageTolerance } = param;
  const quote = getQuotePositionAboveRange(param);
  const tokenMaxB = adjustForSlippage(quote.tokenEstB, slippageTolerance, true);

  return {
    tokenMaxA: ZERO,
    tokenMaxB,
    ...quote,
  };
}
