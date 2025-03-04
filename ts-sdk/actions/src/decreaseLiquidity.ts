import { Address } from "@solana/web3.js";
import {
  closePositionInstructions,
  DecreaseLiquidityQuoteParam,
  decreaseLiquidityInstructions,
} from "@orca-so/whirlpools";
import {
  CollectFeesQuote,
  CollectRewardsQuote,
  DecreaseLiquidityQuote,
} from "@orca-so/whirlpools-core";
import { executeWhirlpoolInstruction } from "./helpers";

// Close a position and collect all fees and rewards
export async function closePosition(
  positionMintAddress: Address,
  slippageToleranceBps?: number
): Promise<{
  callback: () => Promise<string>;
  quote: DecreaseLiquidityQuote;
  feesQuote: CollectFeesQuote;
  rewardsQuote: CollectRewardsQuote;
}> {
  return executeWhirlpoolInstruction(
    closePositionInstructions,
    positionMintAddress,
    slippageToleranceBps
  );
}

// Decrease liquidity from an existing position
export async function decreasePosLiquidity(
  positionMintAddress: Address,
  tokenAmount: DecreaseLiquidityQuoteParam,
  slippageToleranceBps?: number
): Promise<{
  callback: () => Promise<string>;
  quote: DecreaseLiquidityQuote;
}> {
  return executeWhirlpoolInstruction(
    decreaseLiquidityInstructions,
    positionMintAddress,
    tokenAmount,
    slippageToleranceBps
  );
}
