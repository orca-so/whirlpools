import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { TickSpacing } from ".";
import { TICK_ARRAY_SIZE, Whirlpool, WhirlpoolClient, WhirlpoolContext } from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import {
  FundedPositionParams,
  fundPositionsWithClient,
  initTestPoolWithTokens
} from "./init-utils";

export interface SwapTestPoolParams {
  ctx: WhirlpoolContext;
  client: WhirlpoolClient;
  tickSpacing: TickSpacing;
  initSqrtPrice: anchor.BN;
  initArrayStartTicks: number[];
  fundedPositions: FundedPositionParams[];
  tokenMintAmount?: anchor.BN;
}

export interface SwapTestSwapParams {
  swapAmount: BN;
  aToB: boolean;
  amountSpecifiedIsInput: boolean;
  slippageTolerance: Percentage;
  tickArrayAddresses: PublicKey[];
}

export interface SwapTestSetup {
  whirlpool: Whirlpool;
  tickArrayAddresses: PublicKey[];
}

export async function setupSwapTest(setup: SwapTestPoolParams, tokenAIsNative = false) {
  const { whirlpoolPda } = await initTestPoolWithTokens(
    setup.ctx,
    setup.tickSpacing,
    setup.initSqrtPrice,
    setup.tokenMintAmount,
    tokenAIsNative ? NATIVE_MINT : undefined
  );

  const whirlpool = await setup.client.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);

  await (await whirlpool.initTickArrayForTicks(setup.initArrayStartTicks))?.buildAndExecute();

  await fundPositionsWithClient(setup.client, whirlpoolPda.publicKey, setup.fundedPositions);

  return whirlpool;
}

export interface ArrayTickIndex {
  arrayIndex: number;
  offsetIndex: number;
}

export function arrayTickIndexToTickIndex(index: ArrayTickIndex, tickSpacing: number) {
  return index.arrayIndex * TICK_ARRAY_SIZE * tickSpacing + index.offsetIndex * tickSpacing;
}

export function buildPosition(
  lower: ArrayTickIndex,
  upper: ArrayTickIndex,
  tickSpacing: number,
  liquidityAmount: anchor.BN
) {
  return {
    tickLowerIndex: arrayTickIndexToTickIndex(lower, tickSpacing),
    tickUpperIndex: arrayTickIndexToTickIndex(upper, tickSpacing),
    liquidityAmount,
  };
}
