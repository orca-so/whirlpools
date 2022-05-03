import { BN } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { min } from "bn.js";
import Decimal from "decimal.js";
import {
  fromX64_BN,
  fromX64_Decimal,
  tickIndexToSqrtPriceX64,
  toX64,
  toX64_BN,
  toX64_Decimal,
} from ".";

export type TokenAmounts = {
  tokenA: u64;
  tokenB: u64;
};

export function toTokenAmount(a: number, b: number): TokenAmounts {
  return {
    tokenA: new u64(a.toString()),
    tokenB: new u64(b.toString()),
  };
}

/**
 * Estimate the liquidity amount required to increase/decrease liquidity.
 *
 * // TODO: At the top end of the price range, tick calcuation is off therefore the results can be off
 *
 * @param currTick - Whirlpool's current tick index (aka price)
 * @param lowerTick - Position lower tick index
 * @param upperTick - Position upper tick index
 * @param tokenAmount - The desired amount of tokens to deposit/withdraw
 * @returns An estimated amount of liquidity needed to deposit/withdraw the desired amount of tokens.
 */
export function estimateLiquidityFromTokenAmounts(
  currTick: number,
  lowerTick: number,
  upperTick: number,
  tokenAmount: TokenAmounts
): BN {
  if (upperTick < lowerTick) {
    throw new Error("upper tick cannot be lower than the lower tick");
  }

  const currSqrtPrice = tickIndexToSqrtPriceX64(currTick);
  const lowerSqrtPrice = tickIndexToSqrtPriceX64(lowerTick);
  const upperSqrtPrice = tickIndexToSqrtPriceX64(upperTick);

  if (currTick >= upperTick) {
    return estLiquidityForTokenB(upperSqrtPrice, lowerSqrtPrice, tokenAmount.tokenB);
  } else if (currTick < lowerTick) {
    return estLiquidityForTokenA(lowerSqrtPrice, upperSqrtPrice, tokenAmount.tokenA);
  } else {
    const estLiquidityAmountA = estLiquidityForTokenA(
      currSqrtPrice,
      upperSqrtPrice,
      tokenAmount.tokenA
    );
    const estLiquidityAmountB = estLiquidityForTokenB(
      currSqrtPrice,
      lowerSqrtPrice,
      tokenAmount.tokenB
    );
    return BN.min(estLiquidityAmountA, estLiquidityAmountB);
  }
}

export function getTokenAmountsFromLiquidity(
  liquidity: u64,
  currentPrice: u64,
  lowerPrice: u64,
  upperPrice: u64,
  round_up: boolean
): TokenAmounts {
  const _liquidity = new Decimal(liquidity.toString());
  const _currentPrice = new Decimal(currentPrice.toString());
  const _lowerPrice = new Decimal(lowerPrice.toString());
  const _upperPrice = new Decimal(upperPrice.toString());
  let tokenA, tokenB;
  if (currentPrice.lt(lowerPrice)) {
    // x = L * (pb - pa) / (pa * pb)
    tokenA = toX64_Decimal(_liquidity)
      .mul(_upperPrice.sub(_lowerPrice))
      .div(_lowerPrice.mul(_upperPrice));
    tokenB = new Decimal(0);
  } else if (currentPrice.lt(upperPrice)) {
    // x = L * (pb - p) / (p * pb)
    // y = L * (p - pa)
    tokenA = toX64_Decimal(_liquidity)
      .mul(_upperPrice.sub(_currentPrice))
      .div(_currentPrice.mul(_upperPrice));
    tokenB = fromX64_Decimal(_liquidity.mul(_currentPrice.sub(_lowerPrice)));
  } else {
    // y = L * (pb - pa)
    tokenA = new Decimal(0);
    tokenB = fromX64_Decimal(_liquidity.mul(_upperPrice.sub(_lowerPrice)));
  }

  // TODO: round up
  if (round_up) {
    return {
      tokenA: new u64(tokenA.ceil().toString()),
      tokenB: new u64(tokenB.ceil().toString()),
    };
  } else {
    return {
      tokenA: new u64(tokenA.floor().toString()),
      tokenB: new u64(tokenB.floor().toString()),
    };
  }
}

// Convert this function based on Delta A = Delta L * (1/sqrt(lower) - 1/sqrt(upper))
function estLiquidityForTokenA(sqrtPrice1: BN, sqrtPrice2: BN, tokenAmount: u64) {
  const lowerSqrtPriceX64 = BN.min(sqrtPrice1, sqrtPrice2);
  const upperSqrtPriceX64 = BN.max(sqrtPrice1, sqrtPrice2);

  const num = fromX64_BN(tokenAmount.mul(upperSqrtPriceX64).mul(lowerSqrtPriceX64));
  const dem = upperSqrtPriceX64.sub(lowerSqrtPriceX64);

  return num.div(dem);
}

// Convert this function based on Delta B = Delta L * (sqrt_price(upper) - sqrt_price(lower))
function estLiquidityForTokenB(sqrtPrice1: BN, sqrtPrice2: BN, tokenAmount: u64) {
  const lowerSqrtPriceX64 = BN.min(sqrtPrice1, sqrtPrice2);
  const upperSqrtPriceX64 = BN.max(sqrtPrice1, sqrtPrice2);

  const delta = upperSqrtPriceX64.sub(lowerSqrtPriceX64);

  return toX64_BN(tokenAmount).div(delta);
}
