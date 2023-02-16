import { AddressUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { WhirlpoolContext } from "../context";
import {
  ORCA_SUPPORTED_TICK_SPACINGS,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  TOKEN_MINTS,
} from "../types/public";
import { SwapUtils, PDAUtil, PoolUtil } from "../utils/public";
import { convertListToMap } from "../utils/txn-utils";
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

async function getPoolsForMints(
  ctx: WhirlpoolContext,
  mints: PublicKey[],
  baseTokens = [TOKEN_MINTS["USDC"], TOKEN_MINTS["SOL"]]
): Promise<PoolMap> {
  const poolAddresses: string[] = mints
    .map((mint): string[] =>
      ORCA_SUPPORTED_TICK_SPACINGS.map((tickSpacing): string[] => {
        return baseTokens.map((baseToken): string => {
          const [mintA, mintB] = PoolUtil.orderMints(mint, baseToken);
          return PDAUtil.getWhirlpool(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            ORCA_WHIRLPOOLS_CONFIG,
            AddressUtil.toPubKey(mintA),
            AddressUtil.toPubKey(mintB),
            tickSpacing
          ).publicKey.toBase58();
        });
      }).flat()
    )
    .flat();

  const poolDatas = await ctx.fetcher.listPools(poolAddresses, true);

  const [filteredPoolDatas, filteredPoolAddresses] = filterNullObjects(poolDatas, poolAddresses);
  return convertListToMap(filteredPoolDatas, filteredPoolAddresses);
}

// Filter out null objects in the first array and remove the corresponding objects in the second array
function filterNullObjects<T, K>(
  firstArray: Array<T | null>,
  secondArray: Array<K>
): [Array<T>, Array<K>] {
  const filteredFirstArray: Array<T> = [];
  const filteredSecondArray: Array<K> = [];

  firstArray.forEach((item, idx) => {
    if (item !== null) {
      filteredFirstArray.push(item);
      filteredSecondArray.push(secondArray[idx]);
    }
  });

  return [filteredFirstArray, filteredSecondArray];
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
    .flat()
    .map((tickArray): string => tickArray.toBase58());

  const tickArrays = await ctx.fetcher.listTickArrays(tickArrayAddresses, true);

  const [filteredTickArrays, filteredTickArrayAddresses] = filterNullObjects(
    tickArrays,
    tickArrayAddresses
  );
  return convertListToMap(filteredTickArrays, filteredTickArrayAddresses);
}
