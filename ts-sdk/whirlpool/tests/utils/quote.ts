import {
  increaseLiquidityQuoteA,
  increaseLiquidityQuoteB,
  type IncreaseLiquidityQuote,
} from "@orca-so/whirlpools-core";
import type { IncreaseLiquidityParam } from "../../src";

export function getConstrainingQuote(
  param: IncreaseLiquidityParam,
  slippageToleranceBps: number,
  sqrtPrice: bigint,
  tickLower: number,
  tickUpper: number,
): IncreaseLiquidityQuote {
  const quoteArgs = [
    slippageToleranceBps,
    sqrtPrice,
    tickLower,
    tickUpper,
  ] as const;

  const quoteA = increaseLiquidityQuoteA(param.tokenMaxA, ...quoteArgs);
  const quoteB = increaseLiquidityQuoteB(param.tokenMaxB, ...quoteArgs);

  const liquidityA = quoteA.liquidityDelta;
  const liquidityB = quoteB.liquidityDelta;

  return liquidityA === 0n
    ? quoteB
    : liquidityB === 0n
      ? quoteA
      : liquidityA < liquidityB
        ? quoteA
        : quoteB;
}
