import type * as anchor from "@coral-xyz/anchor";
import type { Percentage } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import Decimal from "decimal.js";
import type { TickSpacing } from "..";
import type {
  Whirlpool,
  WhirlpoolClient,
  WhirlpoolContext,
} from "../../../src";
import { PoolUtil, PriceMath } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import type { FundedPositionV2Params, TokenTrait } from "./init-utils-v2";
import { initTestPoolWithTokensV2, useMaxCU } from "./init-utils-v2";

export interface SwapTestPoolParams {
  ctx: WhirlpoolContext;
  client: WhirlpoolClient;
  tokenTraitA: TokenTrait;
  tokenTraitB: TokenTrait;
  tickSpacing: TickSpacing;
  initSqrtPrice: anchor.BN;
  initArrayStartTicks: number[];
  fundedPositions: FundedPositionV2Params[];
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

const ALLOWABLE_PRICE_DEVIATION = 0.0001; // 1 b.p.

export async function setupSwapTestV2(setup: SwapTestPoolParams) {
  const { whirlpoolPda } = await initTestPoolWithTokensV2(
    setup.ctx,
    setup.tokenTraitA,
    setup.tokenTraitB,
    setup.tickSpacing,
    setup.initSqrtPrice,
    setup.tokenMintAmount,
  );

  const whirlpool = await setup.client.getPool(
    whirlpoolPda.publicKey,
    IGNORE_CACHE,
  );

  await (
    await whirlpool.initTickArrayForTicks(setup.initArrayStartTicks)
  )?.buildAndExecute();

  await fundPositionsWithClient(
    setup.client,
    whirlpoolPda.publicKey,
    setup.fundedPositions,
  );

  return whirlpool;
}

export async function fundPositionsWithClient(
  client: WhirlpoolClient,
  whirlpoolKey: PublicKey,
  fundParams: FundedPositionV2Params[],
) {
  const whirlpool = await client.getPool(whirlpoolKey, IGNORE_CACHE);
  const whirlpoolData = whirlpool.getData();
  const ctx = client.getContext();
  const tokenDecimalsA =
    (await ctx.fetcher.getMintInfo(whirlpoolData.tokenMintA))?.decimals ?? 0;
  const tokenDecimalsB =
    (await ctx.fetcher.getMintInfo(whirlpoolData.tokenMintB))?.decimals ?? 0;
  const currentPrice = PriceMath.sqrtPriceX64ToPrice(
    whirlpoolData.sqrtPrice,
    tokenDecimalsA,
    tokenDecimalsB,
  );
  const deviation = new Decimal(ALLOWABLE_PRICE_DEVIATION);
  const minSqrtPrice = PriceMath.priceToSqrtPriceX64(
    currentPrice.mul(new Decimal(1).minus(deviation)),
    tokenDecimalsA,
    tokenDecimalsB,
  );
  const maxSqrtPrice = PriceMath.priceToSqrtPriceX64(
    currentPrice.mul(new Decimal(1).plus(deviation)),
    tokenDecimalsA,
    tokenDecimalsB,
  );
  for (const param of fundParams) {
    const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
      param.liquidityAmount,
      whirlpoolData.sqrtPrice,
      PriceMath.tickIndexToSqrtPriceX64(param.tickLowerIndex),
      PriceMath.tickIndexToSqrtPriceX64(param.tickUpperIndex),
      true,
    );

    const { tx } = await whirlpool.openPosition(
      param.tickLowerIndex,
      param.tickUpperIndex,
      {
        tokenMaxA: tokenA,
        tokenMaxB: tokenB,
        minSqrtPrice,
        maxSqrtPrice,
      },
    );
    await tx.addInstruction(useMaxCU()).buildAndExecute();
  }
}
