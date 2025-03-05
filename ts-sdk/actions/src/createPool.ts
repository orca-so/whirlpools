import type { Address } from "@solana/kit";
import {
  createSplashPoolInstructions,
  createConcentratedLiquidityPoolInstructions,
} from "@orca-so/whirlpools";
import { executeWhirlpoolInstruction } from "./helpers";

// Create a splash liquidity pool
export async function createSplashPool(
  tokenMintA: Address,
  tokenMintB: Address,
  initialPrice: number,
) {
  return executeWhirlpoolInstruction(
    createSplashPoolInstructions,
    tokenMintA,
    tokenMintB,
    initialPrice,
  );
}

// Create a concentrated liquidity pool
export async function createConcentratedLiquidityPool(
  tokenMintA: Address,
  tokenMintB: Address,
  tickSpacing: number,
  initialPrice: number,
) {
  return executeWhirlpoolInstruction(
    createConcentratedLiquidityPoolInstructions,
    tokenMintA,
    tokenMintB,
    tickSpacing,
    initialPrice,
  );
}
