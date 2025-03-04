import type { Address, Lamports } from "@solana/kit";
import type {
  IncreaseLiquidityQuoteParam} from "@orca-so/whirlpools";
import {
  openPositionInstructions,
  openFullRangePositionInstructions,
  increaseLiquidityInstructions,
} from "@orca-so/whirlpools";
import type { IncreaseLiquidityQuote } from "@orca-so/whirlpools-core";
import { executeWhirlpoolInstruction } from "./helpers";

// Open a concentrated liquidity position
export async function openConcentratedPosition(
  poolAddress: Address,
  tokenAmount: IncreaseLiquidityQuoteParam,
  lowerPrice: number,
  upperPrice: number,
  slippageToleranceBps?: number,
): Promise<{
  callback: () => Promise<string>;
  quote: IncreaseLiquidityQuote;
  initializationCost: Lamports;
  positionMint: Address;
}> {
  return executeWhirlpoolInstruction(
    openPositionInstructions,
    poolAddress,
    tokenAmount,
    lowerPrice,
    upperPrice,
    slippageToleranceBps,
  );
}

// Open a full range position
export async function openFullRangePosition(
  poolAddress: Address,
  tokenAmount: IncreaseLiquidityQuoteParam,
  slippageToleranceBps?: number,
): Promise<{
  callback: () => Promise<string>;
  quote: IncreaseLiquidityQuote;
  initializationCost: Lamports;
}> {
  return executeWhirlpoolInstruction(
    openFullRangePositionInstructions,
    poolAddress,
    tokenAmount,
    slippageToleranceBps,
  );
}

// Increase liquidity in an existing position
export async function increasePosLiquidity(
  positionMintAddress: Address,
  tokenAmount: IncreaseLiquidityQuoteParam,
  slippageToleranceBps?: number,
): Promise<{
  callback: () => Promise<string>;
  quote: IncreaseLiquidityQuote;
}> {
  return executeWhirlpoolInstruction(
    increaseLiquidityInstructions,
    positionMintAddress,
    tokenAmount,
    slippageToleranceBps,
  );
}
