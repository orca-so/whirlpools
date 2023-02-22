import { AddressUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { DecimalsMap, defaultConfig, PoolMap, PriceMap, TickArrayMap } from ".";
import { WhirlpoolContext } from "../context";
import { SwapUtils, PDAUtil, PoolUtil } from "../utils/public";
import { convertListToMap, filterNullObjects } from "../utils/txn-utils";
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
  config = defaultConfig,
  refresh = true
): Promise<PriceMap> {
  const poolMap = await fetchPoolsForMints(ctx, mints, config, refresh);
  const tickArrayMap = await fetchTickArraysForPools(ctx, poolMap, config, refresh);
  const decimalsMap = await fetchDecimalsForMints(ctx, mints, refresh);

  return calculatePoolPrices(mints, poolMap, tickArrayMap, decimalsMap);
}

export async function fetchDecimalsForMints(
  ctx: WhirlpoolContext,
  mints: PublicKey[],
  refresh = true
): Promise<DecimalsMap> {
  const mintInfos = await ctx.fetcher.listMintInfos(mints, refresh);
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
  config = defaultConfig,
  refresh = true
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

  const poolDatas = await ctx.fetcher.listPools(poolAddresses, refresh);

  const [filteredPoolDatas, filteredPoolAddresses] = filterNullObjects(poolDatas, poolAddresses);
  return convertListToMap(filteredPoolDatas, filteredPoolAddresses);
}

export async function fetchTickArraysForPools(
  ctx: WhirlpoolContext,
  pools: PoolMap,
  config = defaultConfig,
  refresh = true
): Promise<TickArrayMap> {
  const { programId } = config;
  const tickArrayAddresses = Object.entries(pools)
    .map(([poolAddress, pool]): PublicKey[] => {
      const aToBTickArrayPublicKeys = SwapUtils.getTickArrayPublicKeys(
        pool.tickCurrentIndex,
        pool.tickSpacing,
        true,
        programId,
        new PublicKey(poolAddress)
      );

      const bToATickArrayPublicKeys = SwapUtils.getTickArrayPublicKeys(
        pool.tickCurrentIndex,
        pool.tickSpacing,
        false,
        programId,
        new PublicKey(poolAddress)
      );

      // Fetch tick arrays in both directions
      return [...aToBTickArrayPublicKeys, ...bToATickArrayPublicKeys.slice(1)];
    })
    .flat()
    .map((tickArray): string => tickArray.toBase58());

  const tickArrays = await ctx.fetcher.listTickArrays(tickArrayAddresses, refresh);

  const [filteredTickArrays, filteredTickArrayAddresses] = filterNullObjects(
    tickArrays,
    tickArrayAddresses
  );
  return convertListToMap(filteredTickArrays, filteredTickArrayAddresses);
}
