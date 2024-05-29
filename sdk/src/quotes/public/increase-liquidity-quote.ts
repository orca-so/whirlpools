import { Address } from "@coral-xyz/anchor";
import { AddressUtil, DecimalUtil, MintWithTokenProgram, Percentage, ZERO } from "@orca-so/common-sdk";
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
import { TokenExtensionContextForPool, TokenExtensionUtil } from "../../utils/public/token-extension-util";


/*** --------- Quote by Input Token --------- ***/

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
  tokenExtensionCtx: TokenExtensionContextForPool;
  slippageTolerance: Percentage;
};

/**
 * Return object from increase liquidity quote functions.
 * @category Quotes
 */
export type IncreaseLiquidityQuote = IncreaseLiquidityInput & IncreaseLiquidityEstimate;
type IncreaseLiquidityEstimate = {
  liquidityAmount: BN;
  tokenEstA: BN;
  tokenEstB: BN;
  transferFee: {
    deductingFromTokenMaxA: BN;
    deductingFromTokenMaxB: BN;
    deductingFromTokenEstA: BN;
    deductingFromTokenEstB: BN;
  };
};

/**
 * Get an estimated quote on the maximum tokens required to deposit based on a specified input token amount.
 * This new version calculates slippage based on price percentage movement, rather than setting the percentage threshold based on token estimates.
 *
 * @category Quotes
 * @param inputTokenAmount - The amount of input tokens to deposit.
 * @param inputTokenMint - The mint of the input token the user would like to deposit.
 * @param tickLower - The lower index of the position that we are depositing into.
 * @param tickUpper - The upper index of the position that we are depositing into.
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 * @param whirlpool - A Whirlpool helper class to help interact with the Whirlpool account.
 * @returns An IncreaseLiquidityInput object detailing the required token amounts & liquidity values to use when calling increase-liquidity-ix.
 */
export function increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
  inputTokenMint: Address,
  inputTokenAmount: Decimal,
  tickLower: number,
  tickUpper: number,
  slippageTolerance: Percentage,
  whirlpool: Whirlpool,
  tokenExtensionCtx: TokenExtensionContextForPool,
) {
  const data = whirlpool.getData();
  const tokenAInfo = whirlpool.getTokenAInfo();
  const tokenBInfo = whirlpool.getTokenBInfo();

  const inputMint = AddressUtil.toPubKey(inputTokenMint);
  const inputTokenInfo = inputMint.equals(tokenAInfo.mint) ? tokenAInfo : tokenBInfo;

  return increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage({
    inputTokenMint: inputMint,
    inputTokenAmount: DecimalUtil.toBN(inputTokenAmount, inputTokenInfo.decimals),
    tickLowerIndex: TickUtil.getInitializableTickIndex(tickLower, data.tickSpacing),
    tickUpperIndex: TickUtil.getInitializableTickIndex(tickUpper, data.tickSpacing),
    slippageTolerance,
    tokenExtensionCtx,
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
export function increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage(
  param: IncreaseLiquidityQuoteParam
): IncreaseLiquidityQuote {
  invariant(TickUtil.checkTickInBounds(param.tickLowerIndex), "tickLowerIndex is out of bounds.");
  invariant(TickUtil.checkTickInBounds(param.tickUpperIndex), "tickUpperIndex is out of bounds.");
  invariant(
    param.inputTokenMint.equals(param.tokenMintA) || param.inputTokenMint.equals(param.tokenMintB),
    `input token mint ${param.inputTokenMint.toBase58()} does not match any tokens in the provided pool.`
  );

  const liquidity = getLiquidityFromInputToken(param);

  if (liquidity.eq(ZERO)) {
    return {
      liquidityAmount: ZERO,
      tokenMaxA: ZERO,
      tokenMaxB: ZERO,
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      transferFee: {
        deductingFromTokenMaxA: ZERO,
        deductingFromTokenMaxB: ZERO,
        deductingFromTokenEstA: ZERO,
        deductingFromTokenEstB: ZERO,
      },
    };
  }

  return increaseLiquidityQuoteByLiquidityWithParams({
    liquidity,
    tickCurrentIndex: param.tickCurrentIndex,
    sqrtPrice: param.sqrtPrice,
    tickLowerIndex: param.tickLowerIndex,
    tickUpperIndex: param.tickUpperIndex,
    slippageTolerance: param.slippageTolerance,
    tokenExtensionCtx: param.tokenExtensionCtx,
  });
}

function getLiquidityFromInputToken(params: IncreaseLiquidityQuoteParam) {
  const { inputTokenMint, inputTokenAmount, tickLowerIndex, tickUpperIndex, sqrtPrice, tokenExtensionCtx } = params;
  invariant(tickLowerIndex < tickUpperIndex, `tickLowerIndex(${tickLowerIndex}) must be less than tickUpperIndex(${tickUpperIndex})`);

  if (inputTokenAmount.eq(ZERO)) {
    return ZERO;
  }

  const isTokenA = params.tokenMintA.equals(inputTokenMint);
  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const positionStatus = PositionUtil.getStrictPositionStatus(sqrtPrice, tickLowerIndex, tickUpperIndex);

  if (positionStatus === PositionStatus.BelowRange) {
    if (!isTokenA) {
      return ZERO;
    }

    const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      inputTokenAmount,
      tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtx.currentEpoch,
    );
    return getLiquidityFromTokenA(transferFeeExcludedInputTokenAmount.amount, sqrtPriceLowerX64, sqrtPriceUpperX64, false);
  }

  if (positionStatus === PositionStatus.AboveRange) {
    if (isTokenA) {
      return ZERO;
    }

    const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      inputTokenAmount,
      tokenExtensionCtx.tokenMintWithProgramB,
      tokenExtensionCtx.currentEpoch,
    );
    return getLiquidityFromTokenB(transferFeeExcludedInputTokenAmount.amount, sqrtPriceLowerX64, sqrtPriceUpperX64, false);
  }

  if (isTokenA) {
    const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      inputTokenAmount,
      tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtx.currentEpoch,
    );
    return getLiquidityFromTokenA(transferFeeExcludedInputTokenAmount.amount, sqrtPrice, sqrtPriceUpperX64, false)
  } else {
    const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      inputTokenAmount,
      tokenExtensionCtx.tokenMintWithProgramB,
      tokenExtensionCtx.currentEpoch,
    );
    return getLiquidityFromTokenB(transferFeeExcludedInputTokenAmount.amount, sqrtPriceLowerX64, sqrtPrice, false);
  }
}

/*** --------- Quote by Liquidity --------- ***/

/**
 * @category Quotes
 * @param liquidity - The amount of liquidity value to deposit into the Whirlpool.
 * @param tokenMintA - The mint of tokenA in the Whirlpool the user is depositing into.
 * @param tokenMintB -The mint of tokenB in the Whirlpool the user is depositing into.
 * @param tickCurrentIndex - The Whirlpool's current tickIndex
 * @param sqrtPrice - The Whirlpool's current sqrtPrice
 * @param tickLowerIndex - The lower index of the position that we are withdrawing from.
 * @param tickUpperIndex - The upper index of the position that we are withdrawing from.
 * @param slippageTolerance - The maximum slippage allowed when calculating the minimum tokens received.
 */
export type IncreaseLiquidityQuoteByLiquidityParam = {
  liquidity: BN;
  tickCurrentIndex: number;
  sqrtPrice: BN;
  tickLowerIndex: number;
  tickUpperIndex: number;
  tokenExtensionCtx: TokenExtensionContextForPool;
  slippageTolerance: Percentage;
};

export function increaseLiquidityQuoteByLiquidityWithParams(params: IncreaseLiquidityQuoteByLiquidityParam): IncreaseLiquidityQuote {
  if (params.liquidity.eq(ZERO)) {
    return {
      liquidityAmount: ZERO,
      tokenMaxA: ZERO,
      tokenMaxB: ZERO,
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      transferFee: {
        deductingFromTokenMaxA: ZERO,
        deductingFromTokenMaxB: ZERO,
        deductingFromTokenEstA: ZERO,
        deductingFromTokenEstB: ZERO,
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

  const tokenMaxA = BN.max(BN.max(tokenEstA, tokenEstALower), tokenEstAUpper);
  const tokenMaxB = BN.max(BN.max(tokenEstB, tokenEstBLower), tokenEstBUpper);

  const tokenExtensionCtx = params.tokenExtensionCtx;
  const tokenMaxAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenMaxA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenEstAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenEstA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenMaxBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenMaxB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);
  const tokenEstBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenEstB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);

  return {
    liquidityAmount: params.liquidity,
    tokenMaxA: tokenMaxAIncluded.amount,
    tokenMaxB: tokenMaxBIncluded.amount,
    tokenEstA: tokenEstAIncluded.amount,
    tokenEstB: tokenEstBIncluded.amount,
    transferFee: {
      deductingFromTokenMaxA: tokenMaxAIncluded.fee,
      deductingFromTokenMaxB: tokenMaxBIncluded.fee,
      deductingFromTokenEstA: tokenEstAIncluded.fee,
      deductingFromTokenEstB: tokenEstBIncluded.fee,
    },
  };
}

function getTokenEstimatesFromLiquidity(params: IncreaseLiquidityQuoteByLiquidityParam) {
  const {
    liquidity,
    sqrtPrice,
    tickLowerIndex,
    tickUpperIndex
  } = params;
  if (liquidity.eq(ZERO)) {
    throw new Error("liquidity must be greater than 0");
  }
  let tokenEstA = ZERO;
  let tokenEstB = ZERO;

  const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const positionStatus = PositionUtil.getStrictPositionStatus(sqrtPrice, tickLowerIndex, tickUpperIndex);

  if (positionStatus === PositionStatus.BelowRange) {
    tokenEstA = getTokenAFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, true);
  } else if (positionStatus === PositionStatus.InRange) {
    tokenEstA = getTokenAFromLiquidity(liquidity, sqrtPrice, upperSqrtPrice, true);
    tokenEstB = getTokenBFromLiquidity(liquidity, lowerSqrtPrice, sqrtPrice, true);
  } else {
    tokenEstB = getTokenBFromLiquidity(liquidity, lowerSqrtPrice, upperSqrtPrice, true);
  }

  return { tokenEstA, tokenEstB };
}

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
  inputTokenMint: Address,
  inputTokenAmount: Decimal,
  tickLower: number,
  tickUpper: number,
  slippageTolerance: Percentage,
  whirlpool: Whirlpool,
  tokenExtensionCtx: TokenExtensionContextForPool,
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
    tokenExtensionCtx,
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
  const {
    tokenMintA,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
    tokenExtensionCtx,
    slippageTolerance,
  } = param;

  if (!tokenMintA.equals(inputTokenMint)) {
    return {
      liquidityAmount: ZERO,
      tokenMaxA: ZERO,
      tokenMaxB: ZERO,
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      transferFee: {
        deductingFromTokenMaxA: ZERO,
        deductingFromTokenMaxB: ZERO,
        deductingFromTokenEstA: ZERO,
        deductingFromTokenEstB: ZERO,
      },
    };
  }

  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
    inputTokenAmount,
    tokenExtensionCtx.tokenMintWithProgramA,
    tokenExtensionCtx.currentEpoch,
  );

  const liquidityAmount = getLiquidityFromTokenA(
    transferFeeExcludedInputTokenAmount.amount,
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
  const tokenMaxA = adjustForSlippage(tokenEstA, slippageTolerance, true);

  const tokenMaxAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenMaxA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenEstAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenEstA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);

  return {
    liquidityAmount,
    tokenMaxA: tokenMaxAIncluded.amount,
    tokenMaxB: ZERO,
    tokenEstA: tokenEstAIncluded.amount,
    tokenEstB: ZERO,
    transferFee: {
      deductingFromTokenMaxA: tokenMaxAIncluded.fee,
      deductingFromTokenMaxB: ZERO,
      deductingFromTokenEstA: tokenEstAIncluded.fee,
      deductingFromTokenEstB: ZERO,
    },
  };
}

/**
 * @deprecated
 */
function quotePositionInRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityQuote {
  const {
    tokenMintA,
    tokenMintB,
    sqrtPrice,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
    tokenExtensionCtx,
    slippageTolerance,
  } = param;

  const sqrtPriceX64 = sqrtPrice;
  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  let tokenEstA: BN;
  let tokenEstB: BN;
  let liquidityAmount: BN;

  if (tokenMintA.equals(inputTokenMint)) {
    const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      inputTokenAmount,
      tokenExtensionCtx.tokenMintWithProgramA,
      tokenExtensionCtx.currentEpoch,
    );
    liquidityAmount = getLiquidityFromTokenA(transferFeeExcludedInputTokenAmount.amount, sqrtPriceX64, sqrtPriceUpperX64, false);
    tokenEstA = getTokenAFromLiquidity(liquidityAmount, sqrtPriceX64, sqrtPriceUpperX64, true);
    tokenEstB = getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceX64, true);
  } else if (tokenMintB.equals(inputTokenMint)) {
    const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
      inputTokenAmount,
      tokenExtensionCtx.tokenMintWithProgramB,
      tokenExtensionCtx.currentEpoch,
    );
    liquidityAmount = getLiquidityFromTokenB(transferFeeExcludedInputTokenAmount.amount, sqrtPriceLowerX64, sqrtPriceX64, false);
    tokenEstA = getTokenAFromLiquidity(liquidityAmount, sqrtPriceX64, sqrtPriceUpperX64, true);
    tokenEstB = getTokenBFromLiquidity(liquidityAmount, sqrtPriceLowerX64, sqrtPriceX64, true);
  } else {
    throw new Error("invariant violation");
  }

  const tokenMaxA = adjustForSlippage(tokenEstA, slippageTolerance, true);
  const tokenMaxB = adjustForSlippage(tokenEstB, slippageTolerance, true);

  const tokenMaxAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenMaxA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenEstAIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenEstA, tokenExtensionCtx.tokenMintWithProgramA, tokenExtensionCtx.currentEpoch);
  const tokenMaxBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenMaxB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);
  const tokenEstBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenEstB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);

  return {
    liquidityAmount,
    tokenMaxA: tokenMaxAIncluded.amount,
    tokenMaxB: tokenMaxBIncluded.amount,
    tokenEstA: tokenEstAIncluded.amount,
    tokenEstB: tokenEstBIncluded.amount,
    transferFee: {
      deductingFromTokenMaxA: tokenMaxAIncluded.fee,
      deductingFromTokenMaxB: tokenMaxBIncluded.fee,
      deductingFromTokenEstA: tokenEstAIncluded.fee,
      deductingFromTokenEstB: tokenEstBIncluded.fee,
    },
  };
}

/**
 * @deprecated
 */
function quotePositionAboveRange(param: IncreaseLiquidityQuoteParam): IncreaseLiquidityQuote {
  const {
    tokenMintB,
    inputTokenMint,
    inputTokenAmount,
    tickLowerIndex,
    tickUpperIndex,
    tokenExtensionCtx,
    slippageTolerance,
  } = param;

  if (!tokenMintB.equals(inputTokenMint)) {
    return {
      liquidityAmount: ZERO,
      tokenMaxA: ZERO,
      tokenMaxB: ZERO,
      tokenEstA: ZERO,
      tokenEstB: ZERO,
      transferFee: {
        deductingFromTokenMaxA: ZERO,
        deductingFromTokenMaxB: ZERO,
        deductingFromTokenEstA: ZERO,
        deductingFromTokenEstB: ZERO,
      },
    };
  }

  const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(tickLowerIndex);
  const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(tickUpperIndex);

  const transferFeeExcludedInputTokenAmount = TokenExtensionUtil.calculateTransferFeeExcludedAmount(
    inputTokenAmount,
    tokenExtensionCtx.tokenMintWithProgramB,
    tokenExtensionCtx.currentEpoch,
  );

  const liquidityAmount = getLiquidityFromTokenB(
    transferFeeExcludedInputTokenAmount.amount,
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
  const tokenMaxB = adjustForSlippage(tokenEstB, slippageTolerance, true);

  const tokenMaxBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenMaxB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);
  const tokenEstBIncluded = TokenExtensionUtil.calculateTransferFeeIncludedAmount(tokenEstB, tokenExtensionCtx.tokenMintWithProgramB, tokenExtensionCtx.currentEpoch);

  return {
    liquidityAmount,
    tokenMaxA: ZERO,
    tokenMaxB: tokenMaxBIncluded.amount,
    tokenEstA: ZERO,
    tokenEstB: tokenEstBIncluded.amount,
    transferFee: {
      deductingFromTokenMaxA: ZERO,
      deductingFromTokenMaxB: tokenMaxBIncluded.fee,
      deductingFromTokenEstA: ZERO,
      deductingFromTokenEstB: tokenEstBIncluded.fee,
    },
  };
}