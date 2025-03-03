import {
  getRpcConfig,
  rpcFromUrl,
  buildAndSendTransaction,
} from "@orca-so/tx-sender";
import {
  fetchWhirlpoolsByTokenPair,
  swapInstructions,
} from "@orca-so/whirlpools";
import { ExactInSwapQuote, ExactOutSwapQuote } from "@orca-so/whirlpools-core";
import { getPayer } from "./config";
import { Address } from "@solana/web3.js";

// Swap tokens with optional slippage
export async function swapTokens(
  inputMint: Address,
  outputMint: Address,
  amount: bigint,
  isExactIn: boolean = true,
  slippageToleranceBps?: number
): Promise<{
  quote: ExactInSwapQuote | ExactOutSwapQuote;
  callback: () => Promise<string>;
}> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  try {
    const pools = await fetchWhirlpoolsByTokenPair(rpc, inputMint, outputMint);

    if (pools.length === 0) {
      throw new Error(
        `No liquidity pool found for ${inputMint} -> ${outputMint}`
      );
    }
    let bestPool: Address | null = null;
    let highestLiquidity = 0n;

    for (const pool of pools) {
      if (pool.initialized && pool.liquidity > highestLiquidity) {
        highestLiquidity = pool.liquidity;
        bestPool = pool.address;
      }
    }

    if (!bestPool) {
      bestPool = pools[0].address;
    }

    // Create swap instructions based on whether this is exactIn or exactOut
    const swapParams = isExactIn
      ? { inputAmount: amount, mint: inputMint }
      : { outputAmount: amount, mint: outputMint };

    const { instructions, quote } = await swapInstructions(
      rpc,
      swapParams,
      bestPool,
      slippageToleranceBps,
      owner
    );
    console.log({ quote });

    return {
      quote,
      callback: () => buildAndSendTransaction(instructions, owner),
    };
  } catch (error) {
    console.error("Error executing token swap:", error);
    throw error;
  }
}
