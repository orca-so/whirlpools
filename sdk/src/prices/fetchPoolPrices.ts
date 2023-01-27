import { PublicKey } from "@solana/web3.js";
import { WhirlpoolContext } from "../context";
import {
  ORCA_SUPPORTED_TICK_SPACINGS,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  TOKEN_MINTS,
} from "../types/public";
import { SwapUtils, PDAUtil } from "../utils/public";
import { calculatePoolPrices, PoolMap, PriceMap, TickArrayMap } from "./calculatePoolPrices";

/**
 * fetchPoolPrices asynchronously fetches the prices for the given mints.
 * The whirlpool accounts and tick array accounts required to calculate the prices are fetched naively.
 * If the caller already has the accounts, it is recommended to use calculatePoolPrices instead.
 * @param ctx
 * @param mints
 * @returns
 */
export async function fetchPoolPrices(
  ctx: WhirlpoolContext,
  mints: PublicKey[]
): Promise<PriceMap> {
  const poolMap = await getPoolsForMints(ctx, mints);
  const tickArrayMap = await getTickArraysForPools(ctx, poolMap);

  return calculatePoolPrices(mints, poolMap, tickArrayMap);
}

async function getPoolsForMints(ctx: WhirlpoolContext, mints: PublicKey[]): Promise<PoolMap> {
  const pools: PoolMap = {};

  const poolAddresses: PublicKey[] = mints
    .map((mint): PublicKey[] =>
      ORCA_SUPPORTED_TICK_SPACINGS.map((tickSpacing): PublicKey[] => {
        const usdcPool = PDAUtil.getWhirlpool(
          ORCA_WHIRLPOOL_PROGRAM_ID,
          ORCA_WHIRLPOOLS_CONFIG,
          mint,
          new PublicKey(TOKEN_MINTS["USDC"]),
          tickSpacing
        ).publicKey;
        const solPool = PDAUtil.getWhirlpool(
          ORCA_WHIRLPOOL_PROGRAM_ID,
          ORCA_WHIRLPOOLS_CONFIG,
          mint,
          new PublicKey(TOKEN_MINTS["SOL"]),
          tickSpacing
        ).publicKey;
        return [usdcPool, solPool];
      }).flat()
    )
    .flat();

  const poolDatas = await ctx.fetcher.listPools(poolAddresses, false);

  return convertDataToMap(poolDatas, poolAddresses);
}

async function getTickArraysForPools(ctx: WhirlpoolContext, pools: PoolMap): Promise<TickArrayMap> {
  const tickArrayAddresses = Object.entries(pools)
    .map(([poolAddress, pool]): PublicKey[] => {
      return SwapUtils.getTickArrayPublicKeys(
        pool.tickCurrentIndex,
        pool.tickSpacing,
        true,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        new PublicKey(poolAddress)
      );
    })
    .flat();

  const tickArrays = await ctx.fetcher.listTickArrays(tickArrayAddresses, true);

  return convertDataToMap(tickArrays, tickArrayAddresses);
}

function convertDataToMap<T>(data: (T | null)[], addresses: PublicKey[]): { [key: string]: T } {
  const map: { [key: string]: T } = {};
  data.forEach((item, idx) => {
    if (item === null) {
      return;
    }

    map[addresses[idx].toBase58()] = item;
  });
  return map;
}
