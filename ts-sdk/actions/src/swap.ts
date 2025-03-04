import { swapInstructions, SwapParams } from "@orca-so/whirlpools";
import { ExactInSwapQuote, ExactOutSwapQuote } from "@orca-so/whirlpools-core";
import { Address } from "@solana/kit";
import { executeWhirlpoolInstruction } from "./helpers";

// Swap tokens with optional slippage
export async function swapTokens(
  poolAddress: Address,
  swapParams: SwapParams,
  slippageToleranceBps?: number
): Promise<{
  quote: ExactInSwapQuote | ExactOutSwapQuote;
  callback: () => Promise<string>;
}> {
  return executeWhirlpoolInstruction(
    swapInstructions,
    swapParams,
    poolAddress,
    slippageToleranceBps
  );
}
