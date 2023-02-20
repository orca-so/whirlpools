import { AddressUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { DecimalsMap, defaultConfig, PoolMap, PriceMap, TickArrayMap } from ".";
import { WhirlpoolContext } from "../context";
import { SwapUtils, PDAUtil, PoolUtil } from "../utils/public";
import { convertListToMap } from "../utils/txn-utils";
import { calculatePoolPrices } from "./calculatePoolPrices";

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
  mints: PublicKey[],
  config = defaultConfig
): Promise<PriceMap> {
  const poolMap = await fetchPoolsForMints(ctx, mints, config);
  const tickArrayMap = await fetchTickArraysForPools(ctx, poolMap, config);
  const decimalsMap = await fetchDecimalsForMints(ctx, mints);

  return calculatePoolPrices(mints, poolMap, tickArrayMap, decimalsMap);
}

export async function fetchDecimalsForMints(
  ctx: WhirlpoolContext,
  mints: PublicKey[]
): Promise<DecimalsMap> {
  const mintInfos = await ctx.fetcher.listMintInfos(mints, true);
  return mintInfos.reduce((acc, mintInfo, index) => {
    if (!mintInfo) {
      throw new Error(`Mint account does not exist: ${mints[index].toBase58()}`);
    }

    acc[mints[index].toBase58()] = mintInfo.decimals;
    return acc;
  }, {} as DecimalsMap);
}

export async function fetchPoolsForMints(
  ctx: WhirlpoolContext,
  mints: PublicKey[],
  config = defaultConfig
): Promise<PoolMap> {
  const { quoteTokens, tickSpacings, programId, whirlpoolsConfig } = config;
  const poolAddresses: string[] = mints
    .map((mint): string[] =>
      tickSpacings
        .map((tickSpacing): string[] => {
          return quoteTokens.map((quoteToken): string => {
            const [mintA, mintB] = PoolUtil.orderMints(mint, quoteToken);
            return PDAUtil.getWhirlpool(
              programId,
              whirlpoolsConfig,
              AddressUtil.toPubKey(mintA),
              AddressUtil.toPubKey(mintB),
              tickSpacing
            ).publicKey.toBase58();
          });
        })
        .flat()
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

export async function fetchTickArraysForPools(
  ctx: WhirlpoolContext,
  pools: PoolMap,
  config = defaultConfig
): Promise<TickArrayMap> {
  const { programId } = config;
  const tickArrayAddresses = Object.entries(pools)
    .map(([poolAddress, pool]): PublicKey[] => {
      return SwapUtils.getTickArrayPublicKeys(
        pool.tickCurrentIndex,
        pool.tickSpacing,
        // TODO: Fetch tick arrays in the correct direction or fetch tick arrays in both directions
        true,
        programId,
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
