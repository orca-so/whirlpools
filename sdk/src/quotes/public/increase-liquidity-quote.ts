import { DecimalUtil, Percentage, ZERO } from "@orca-so/common-sdk";
import { BN } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import invariant from "tiny-invariant";
import { IncreaseLiquidityInput } from "../../instructions";
import { TokenInfo, WhirlpoolData } from "../../types/public";
import {
  PositionUtil,
  PositionStatus,
  getLiquidityFromTokenA,
  adjustForSlippage,
  getTokenAFromLiquidity,
  getTokenBFromLiquidity,
  getLiquidityFromTokenB,
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
  inputTokenAmount: u64;
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
 */
export function increaseLiquidityQuoteByInputToken(
  inputTokenMint: PublicKey,
  inputTokenAmount: Decimal,
  tickLower: number,
  tickUpper: number,
  slippageTolerance: Percentage,
  whirlpool: Whirlpool
) {
  const data = whirlpool.getData();
  const tokenAInfo = whirlpool.getTokenAInfo();
  const tokenBInfo = whirlpool.getTokenBInfo();

  const inputTokenInfo = inputTokenMint.equals(tokenAInfo.mint) ? tokenAInfo : tokenBInfo;

  return increaseLiquidityQuoteByInputTokenWithParams({
    inputTokenMint: inputTokenMint,
    inputTokenAmount: DecimalUtil.toU64(inputTokenAmount, inputTokenInfo.decimals),
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
 */
export function increaseLiquidityQuoteByInputTokenWithParams(
  param: IncreaseLiquidityQuoteParam
): IncreaseLiquidityInput {
  invariant(TickUtil.checkTickInBounds(param.tickLowerIndex), "tickLowerIndex is out of bounds.");
  invariant(TickUtil.checkTickInBounds(param.tickUpperIndex), "tickUpperIndex is out of bounds.");
  invariant(
    param.inputTokenMint.equals(param.tokenMintA) || param.inputTokenMint.equals(param.tokenMintB),
    `input token mint ${param.inputTokenMint.toBase58()} does not match any tokens in the provided pool.`
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

/*** Private ***/

function quotePositionBelowRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityInput {
  const {
    tokenMintA,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
    slippageTolerance,
  } = param;

  if (!tokenMintA.equals(inputTokenMint)) {
    return {
      tokenMaxA: ZERO,
      tokenMaxB: ZERO,
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

  const maxTokenA = adjustForSlippage(
    getTokenAFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceUpperX64, true),
    slippageTolerance,
    true
  );
  const maxTokenB = ZERO;

  return {
    tokenMaxA: maxTokenA,
    tokenMaxB: maxTokenB,
    liquidityAmount,
  };
}

function quotePositionInRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityInput {
  const {
    tokenMintA,
    sqrtPrice,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
    slippageTolerance,
  } = param;

  const sqrtPriceX64 = sqrtPrice;
  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  let [tokenAmountA, tokenAmountB] = tokenMintA.equals(inputTokenMint)
    ? [inputTokenAmount, undefined]
    : [undefined, inputTokenAmount];

  let liquidityAmount: BN;

  if (tokenAmountA) {
    liquidityAmount = getLiquidityFromTokenA(tokenAmountA, sqrtPriceX64, sqrtPriceUpperX64, false);
    tokenAmountA = getTokenAFromLiquidity(liquidityAmount, sqrtPriceX64, sqrtPriceUpperX64, true);
    tokenAmountB = getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceX64, true);
  } else if (tokenAmountB) {
    liquidityAmount = getLiquidityFromTokenB(tokenAmountB, sqrtPriceLowerX64, sqrtPriceX64, false);
    tokenAmountA = getTokenAFromLiquidity(liquidityAmount, sqrtPriceX64, sqrtPriceUpperX64, true);
    tokenAmountB = getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceX64, true);
  } else {
    throw new Error("invariant violation");
  }

  const maxTokenA = adjustForSlippage(tokenAmountA, slippageTolerance, true);
  const maxTokenB = adjustForSlippage(tokenAmountB, slippageTolerance, true);

  return {
    tokenMaxA: maxTokenA,
    tokenMaxB: maxTokenB,
    liquidityAmount,
  };
}

function quotePositionAboveRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityInput {
  const {
    tokenMintB,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
    slippageTolerance,
  } = param;

  if (!tokenMintB.equals(inputTokenMint)) {
    return {
      tokenMaxA: ZERO,
      tokenMaxB: ZERO,
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

  const maxTokenA = ZERO;
  const maxTokenB = adjustForSlippage(
    getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceUpperX64, true),
    slippageTolerance,
    true
  );

  return {
    tokenMaxA: maxTokenA,
    tokenMaxB: maxTokenB,
    liquidityAmount,
  };
}
