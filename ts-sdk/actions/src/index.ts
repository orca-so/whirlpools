import { Address, TransactionSigner, IInstruction } from "@solana/web3.js";
import { getPayer } from "./config";
import {
  buildAndSendTransaction,
  getRpcConfig,
  rpcFromUrl,
} from "@orca-so/tx-sender";
import {
  fetchPositionsForOwner,
  swapInstructions,
  fetchWhirlpoolsByTokenPair,
  harvestPositionInstructions,
} from "@orca-so/whirlpools";
import { wouldExceedTransactionSize } from "./helpers";
import { ExactInSwapQuote, ExactOutSwapQuote } from "@orca-so/whirlpools-core";
export { setDefaultSlippageToleranceBps } from "@orca-so/whirlpools";

// Harvest fees from all positions owned by an address
export async function harvestAllPositionFees(): Promise<string[]> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const positions = await fetchPositionsForOwner(rpc, owner.address);
  const instructionSets: IInstruction[][] = [];
  let currentInstructions: IInstruction[] = [];
  for (const position of positions) {
    if ("positionMint" in position.data) {
      const { instructions } = await harvestPositionInstructions(
        rpc,
        position.data.positionMint,
        owner
      );
      if (wouldExceedTransactionSize(currentInstructions, instructions)) {
        instructionSets.push(currentInstructions);
        currentInstructions = [...instructions];
      } else {
        currentInstructions.push(...instructions);
      }
    }
  }
  return Promise.all(
    instructionSets.map(async (instructions) => {
      let txHash = await buildAndSendTransaction(instructions, owner);
      return String(txHash);
    })
  );
}

// Swap tokens with optional slippage
export async function swapTokens(
  inputMint: Address,
  outputMint: Address,
  amount: bigint,
  isExactIn: boolean = true,
  returnCallbackWithQuote: boolean = false,
  slippageToleranceBps?: number
): Promise<
  | string
  | {
      quote: ExactInSwapQuote | ExactOutSwapQuote;
      callback: () => Promise<string>;
    }
> {
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
    if (returnCallbackWithQuote) {
      return {
        quote,
        callback: () => buildAndSendTransaction(instructions, owner),
      };
    }
    // Build and send transaction
    const txHash = await buildAndSendTransaction(instructions, owner);
    return String(txHash);
  } catch (error) {
    console.error("Error executing token swap:", error);
    throw error;
  }
}

// Create a new concentrated liquidity pool
export async function createNewPool(
  tokenMintA: Address,
  tokenMintB: Address,
  tickSpacing: number,
  initialPrice: number
): Promise<string[]> {
  // Implementation will create a new concentrated liquidity pool
  throw new Error("Not implemented");
}

// Open a concentrated liquidity position
export async function openConcentratedPosition(
  poolAddress: Address,
  tokenAmount: {
    tokenA?: bigint;
    tokenB?: bigint;
    liquidity?: bigint;
  },
  priceRange: {
    lowerPrice: number;
    upperPrice: number;
  },
  slippageToleranceBps?: number
): Promise<string[]> {
  // Implementation will open a concentrated position with specified price range
  throw new Error("Not implemented");
}

// Open a full range position
export async function openFullRangePos(
  poolAddress: Address,
  tokenAmount: {
    tokenA?: bigint;
    tokenB?: bigint;
    liquidity?: bigint;
  },
  slippageToleranceBps?: number
): Promise<string[]> {
  // Implementation will open a full range position
  throw new Error("Not implemented");
}

// Close a position and collect all fees and rewards
export async function closePositionAndCollectFees(
  positionMintAddress: Address,
  slippageToleranceBps?: number,
  authority?: TransactionSigner
): Promise<string[]> {
  // Implementation will close position and collect all fees/rewards
  throw new Error("Not implemented");
}

// Increase liquidity in an existing position
export async function increasePosLiquidity(
  positionMintAddress: Address,
  tokenAmount: {
    tokenA?: bigint;
    tokenB?: bigint;
    liquidity?: bigint;
  },
  slippageToleranceBps?: number
): Promise<string[]> {
  // Implementation will increase liquidity in existing position
  throw new Error("Not implemented");
}

// Decrease liquidity from an existing position
export async function decreasePosLiquidity(
  positionMintAddress: Address,
  tokenAmount: {
    tokenA?: bigint;
    tokenB?: bigint;
    liquidity?: bigint;
  },
  slippageToleranceBps?: number
): Promise<string[]> {
  // Implementation will decrease liquidity from existing position
  throw new Error("Not implemented");
}
