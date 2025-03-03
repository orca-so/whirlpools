import { Address } from "@solana/web3.js";
import { getPayer } from "./config";
import {
  buildAndSendTransaction,
  getRpcConfig,
  rpcFromUrl,
} from "@orca-so/tx-sender";
import {
  createSplashPoolInstructions,
  createConcentratedLiquidityPoolInstructions,
} from "@orca-so/whirlpools";
export { setDefaultSlippageToleranceBps } from "@orca-so/whirlpools";

// Create a splash liquidity pool
export async function createSplashPool(
  tokenMintA: Address,
  tokenMintB: Address,
  initialPrice: number
) {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const { instructions, initializationCost, poolAddress } =
    await createSplashPoolInstructions(
      rpc,
      tokenMintA,
      tokenMintB,
      initialPrice,
      owner
    );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    initializationCost,
    poolAddress,
  };
}

// Create a concentrated liquidity pool
export async function createConcentratedLiquidityPool(
  tokenMintA: Address,
  tokenMintB: Address,
  tickSpacing: number,
  initialPrice: number
) {
  const { rpcUrl } = getRpcConfig();
  const rpc = rpcFromUrl(rpcUrl);
  const owner = getPayer();

  const { instructions, initializationCost, poolAddress } =
    await createConcentratedLiquidityPoolInstructions(
      rpc,
      tokenMintA,
      tokenMintB,
      tickSpacing,
      initialPrice,
      owner
    );

  return {
    callback: () => buildAndSendTransaction(instructions, owner),
    initializationCost,
    poolAddress,
  };
}
