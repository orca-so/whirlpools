import { Address, Lamports } from "@solana/web3.js";
import {
  IncreaseLiquidityQuoteParam,
  openPositionInstructions,
  openFullRangePositionInstructions,
  closePositionInstructions,
  increaseLiquidityInstructions,
  DecreaseLiquidityQuoteParam,
  decreaseLiquidityInstructions,
} from "@orca-so/whirlpools";
import {
  buildAndSendTransaction,
  getRpcConfig,
  rpcFromUrl,
} from "@orca-so/tx-sender";
import { getPayer } from "./config";
import {
  CollectFeesQuote,
  CollectRewardsQuote,
  DecreaseLiquidityQuote,
  IncreaseLiquidityQuote,
} from "@orca-so/whirlpools-core";

// Open a concentrated liquidity position
export async function openConcentratedPosition(
  poolAddress: Address,
  tokenAmount: IncreaseLiquidityQuoteParam,
  lowerPrice: number,
  upperPrice: number,
  slippageToleranceBps?: number
): Promise<{
  callback: () => Promise<string>;
  quote: IncreaseLiquidityQuote;
  initializationCost: Lamports;
  positionMint: Address;
}> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();
  const { instructions, quote, initializationCost, positionMint } =
    await openPositionInstructions(
      rpc,
      poolAddress,
      tokenAmount,
      lowerPrice,
      upperPrice,
      slippageToleranceBps,
      owner
    );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    quote,
    initializationCost,
    positionMint,
  };
}

// Open a full range position
export async function openFullRangePosition(
  poolAddress: Address,
  tokenAmount: IncreaseLiquidityQuoteParam,
  slippageToleranceBps?: number
): Promise<{
  callback: () => Promise<string>;
  quote: IncreaseLiquidityQuote;
  initializationCost: Lamports;
}> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const { instructions, quote, initializationCost } =
    await openFullRangePositionInstructions(
      rpc,
      poolAddress,
      tokenAmount,
      slippageToleranceBps,
      owner
    );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    quote,
    initializationCost,
  };
}

// Close a position and collect all fees and rewards
export async function closePositionAndCollectFees(
  positionMintAddress: Address,
  slippageToleranceBps?: number
): Promise<{
  callback: () => Promise<string>;
  quote: DecreaseLiquidityQuote;
  feesQuote: CollectFeesQuote;
  rewardsQuote: CollectRewardsQuote;
}> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const { instructions, quote, feesQuote, rewardsQuote } =
    await closePositionInstructions(
      rpc,
      positionMintAddress,
      slippageToleranceBps,
      owner
    );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    quote,
    feesQuote,
    rewardsQuote,
  };
}

// Increase liquidity in an existing position
export async function increasePosLiquidity(
  positionMintAddress: Address,
  tokenAmount: IncreaseLiquidityQuoteParam,
  slippageToleranceBps?: number
): Promise<{
  callback: () => Promise<string>;
  quote: IncreaseLiquidityQuote;
}> {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const { instructions, quote } = await increaseLiquidityInstructions(
    rpc,
    positionMintAddress,
    tokenAmount,
    slippageToleranceBps,
    owner
  );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    quote,
  };
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
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const { instructions, quote } = await decreaseLiquidityInstructions(
    rpc,
    positionMintAddress,
    tokenAmount,
    slippageToleranceBps,
    owner
  );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    quote,
  };
}
