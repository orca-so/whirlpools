import { Address } from "@coral-xyz/anchor";
import { AccountFetchOpts, AddressUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import {
  DecimalsMap,
  PoolMap,
  PriceCalculationData,
  PriceMap,
  TickArrayMap,
  defaultGetPricesConfig,
  defaultGetPricesThresholdConfig,
} from ".";
import { WhirlpoolContext } from "../context";
import { AVOID_REFRESH, PREFER_REFRESH } from "../network/public/account-cache";
import { PDAUtil, PoolUtil, SwapUtils } from "../utils/public";
import { convertListToMap, filterNullObjects } from "../utils/txn-utils";
import { calculatePricesForQuoteToken, convertAmount, isSubset } from "./calculate-pool-prices";

/**
 * PriceModule is a static class that provides functions for fetching and calculating
 * token prices for a set of pools or mints.
 *
 * @category PriceModule
 */
export class PriceModule {
  /**
   * Fetches and calculates the prices for a set of tokens.
   * This method will derive the pools that need to be queried from the mints and is not performant.
   *
   * @param ctx {@link WhirlpoolContext}
   * @param mints The mints to fetch prices for.
   * @param config The configuration for the price calculation.
   * @param thresholdConfig - The threshold configuration for the price calculation.
   * @param opts an {@link AccountFetchOpts} object to define fetch and cache options when accessing on-chain accounts
   * @param availableData - Data that is already available to avoid redundant fetches.
   * @returns A map of token addresses to prices.
   */
  static async fetchTokenPricesByMints(
    ctx: WhirlpoolContext,
    mints: Address[],
    config = defaultGetPricesConfig,
    thresholdConfig = defaultGetPricesThresholdConfig,
    opts = PREFER_REFRESH,
    availableData: Partial<PriceCalculationData> = {}
  ): Promise<PriceMap> {
    const poolMap = availableData?.poolMap
      ? availableData?.poolMap
      : await PriceModuleUtils.fetchPoolDataFromMints(ctx, mints, config, opts);
    const tickArrayMap = availableData?.tickArrayMap
      ? availableData.tickArrayMap
      : await PriceModuleUtils.fetchTickArraysForPools(ctx, poolMap, config, opts);
    const decimalsMap = availableData?.decimalsMap
      ? availableData.decimalsMap
      : await PriceModuleUtils.fetchDecimalsForMints(ctx, mints, AVOID_REFRESH);

    return PriceModule.calculateTokenPrices(
      mints,
      {
        poolMap,
        tickArrayMap,
        decimalsMap,
      },
      config,
      thresholdConfig
    );
  }

  /**
   * Fetches and calculates the token prices from a set of pools.
   *
   * @param ctx {@link WhirlpoolContext}
   * @param pools The pools to fetch prices for.
   * @param config The configuration for the price calculation.
   * @param thresholdConfig The threshold configuration for the price calculation.
   * @param opts an {@link AccountFetchOpts} object to define fetch and cache options when accessing on-chain accounts
   * @returns A map of token addresses to prices
   */
  static async fetchTokenPricesByPools(
    ctx: WhirlpoolContext,
    pools: Address[],
    config = defaultGetPricesConfig,
    thresholdConfig = defaultGetPricesThresholdConfig,
    opts: AccountFetchOpts = PREFER_REFRESH
  ): Promise<PriceMap> {
    const poolDatas = Array.from((await ctx.cache.getPools(pools, opts)).values());
    const [filteredPoolDatas, filteredPoolAddresses] = filterNullObjects(poolDatas, pools);
    const poolMap = convertListToMap(
      filteredPoolDatas,
      AddressUtil.toStrings(filteredPoolAddresses)
    );

    const tickArrayMap = await PriceModuleUtils.fetchTickArraysForPools(
      ctx,
      poolMap,
      config,
      opts
    );
    const mints = Array.from(
      Object.values(poolMap).reduce((acc, pool) => {
        acc.add(pool.tokenMintA.toBase58());
        acc.add(pool.tokenMintB.toBase58());
        return acc;
      }, new Set<string>())
    );
    const decimalsMap = await PriceModuleUtils.fetchDecimalsForMints(ctx, mints, AVOID_REFRESH);

    return PriceModule.calculateTokenPrices(
      mints,
      {
        poolMap,
        tickArrayMap,
        decimalsMap,
      },
      config,
      thresholdConfig
    );
  }

  /**
   * Calculate the price of each token in the mints array.
   *
   * Each token will be priced against the first quote token in the config.quoteTokens array
   * with sufficient liquidity. If a token does not have sufficient liquidity against the
   * first quote token, then it will be priced against the next quote token in the array.
   * If a token does not have sufficient liquidity against any quote token,
   * then the price will be set to null.
   *
   * @category PriceModule
   * @param mints The mints to calculate prices for.
   * @param priceCalcData The data required to calculate prices.
   * @param config The configuration for the price calculation.
   * @param thresholdConfig The threshold configuration for the price calculation.
   * @returns A map of token addresses to prices.
   */
  static calculateTokenPrices(
    mints: Address[],
    priceCalcData: PriceCalculationData,
    config = defaultGetPricesConfig,
    thresholdConfig = defaultGetPricesThresholdConfig
  ): PriceMap {
    const { poolMap, decimalsMap, tickArrayMap } = priceCalcData;
    const mintStrings = AddressUtil.toStrings(mints);
    // Ensure that quote tokens are in the mints array
    if (
      !isSubset(
        config.quoteTokens.map((mint) => AddressUtil.toString(mint)),
        mintStrings.map((mint) => mint)
      )
    ) {
      throw new Error("Quote tokens must be in mints array");
    }

    const results: PriceMap = Object.fromEntries(mintStrings.map((mint) => [mint, null]));

    const remainingQuoteTokens = config.quoteTokens.slice();
    let remainingMints = mints.slice();

    while (remainingQuoteTokens.length > 0 && remainingMints.length > 0) {
      // Get prices for mints using the next token in remainingQuoteTokens as the quote token
      const quoteToken = remainingQuoteTokens.shift();
      if (!quoteToken) {
        throw new Error("Unreachable: remainingQuoteTokens is an empty array");
      }

      // Convert the threshold amount out from the first quote token to the current quote token
      let amountOutThresholdAgainstFirstQuoteToken;

      // If the quote token is the first quote token, then the amount out is the threshold amount
      if (quoteToken.equals(config.quoteTokens[0])) {
        amountOutThresholdAgainstFirstQuoteToken = thresholdConfig.amountOut;
      } else {
        const quoteTokenStr = quoteToken.toBase58();
        const quoteTokenPrice = results[quoteTokenStr];
        if (!quoteTokenPrice) {
          throw new Error(
            `Quote token - ${quoteTokenStr} must have a price against the first quote token`
          );
        }

        amountOutThresholdAgainstFirstQuoteToken = convertAmount(
          thresholdConfig.amountOut,
          quoteTokenPrice,
          decimalsMap[config.quoteTokens[0].toBase58()],
          decimalsMap[quoteTokenStr]
        );
      }

      const prices = calculatePricesForQuoteToken(
        remainingMints,
        quoteToken,
        poolMap,
        tickArrayMap,
        decimalsMap,
        config,
        {
          amountOut: amountOutThresholdAgainstFirstQuoteToken,
          priceImpactThreshold: thresholdConfig.priceImpactThreshold,
        }
      );

      const quoteTokenPrice = results[quoteToken.toBase58()] || prices[quoteToken.toBase58()];

      // Populate the results map with the calculated prices.
      // Ensure that the price is quoted against the first quote token and not the current quote token.
      remainingMints.forEach((mintAddr) => {
        const mint = AddressUtil.toString(mintAddr);
        const mintPrice = prices[mint];
        if (mintPrice != null && quoteTokenPrice != null) {
          results[mint] = mintPrice.mul(quoteTokenPrice);
        }
      });

      // Filter out any mints that do not have a price
      remainingMints = remainingMints.filter((mint) => results[AddressUtil.toString(mint)] == null);
    }

    return results;
  }
}

/**
 * A list of utility functions for the price module.
 * @category PriceModule
 */
export class PriceModuleUtils {
  /**
   * Fetch pool data for the given mints by deriving the PDA from all combinations of mints & tick-arrays.
   * Note that this method can be slow.
   *
   * @param ctx {@link WhirlpoolContext}
   * @param mints The mints to fetch pool data for.
   * @param config The configuration for the price calculation.
   * @param opts an {@link AccountFetchOpts} object to define fetch and cache options when accessing on-chain accounts
   * @returns A {@link PoolMap} of pool addresses to pool data.
   */
  static async fetchPoolDataFromMints(
    ctx: WhirlpoolContext,
    mints: Address[],
    config = defaultGetPricesConfig,
    opts = PREFER_REFRESH
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

    const poolDatas = Array.from((await ctx.cache.getPools(poolAddresses, opts)).values());

    const [filteredPoolDatas, filteredPoolAddresses] = filterNullObjects(poolDatas, poolAddresses);
    return convertListToMap(filteredPoolDatas, filteredPoolAddresses);
  }

  /**
   * Fetch tick-array data for the given pools
   *
   * @param ctx {@link WhirlpoolData}
   * @param pools The pools to fetch tick-array data for.
   * @param config The configuration for the price calculation.
   * @param opts an {@link AccountFetchOpts} object to define fetch and cache options when accessing on-chain accounts
   * @returns A {@link TickArrayMap} of tick-array addresses to tick-array data.
   */
  static async fetchTickArraysForPools(
    ctx: WhirlpoolContext,
    pools: PoolMap,
    config = defaultGetPricesConfig,
    opts: AccountFetchOpts = PREFER_REFRESH
  ): Promise<TickArrayMap> {
    const { programId } = config;

    const getQuoteTokenOrder = (mint: PublicKey) => {
      const index = config.quoteTokens.findIndex((quoteToken) => quoteToken.equals(mint));
      return index === -1 ? config.quoteTokens.length : index;
    };

    // select tick arrays based on the direction of swapQuote
    // TickArray is a large account, which affects decoding time.
    // Fetching can be performed in parallel, but it is preferable to fetch the minimum number of accounts necessary.
    const tickArrayAddressSet = new Set<string>();
    Object.entries(pools).forEach(([address, pool]) => {
      const orderA = getQuoteTokenOrder(pool.tokenMintA);
      const orderB = getQuoteTokenOrder(pool.tokenMintB);

      if (orderA === orderB) {
        // neither tokenMintA nor tokenMintB is a quote token
        return;
      }

      const aToB = orderA > orderB;

      const tickArrayPubkeys = SwapUtils.getTickArrayPublicKeys(
        pool.tickCurrentIndex,
        pool.tickSpacing,
        aToB,
        programId,
        new PublicKey(address)
      );
      tickArrayPubkeys.forEach((p) => tickArrayAddressSet.add(p.toBase58()));
    });
    const tickArrayAddresses = Array.from(tickArrayAddressSet);

    const tickArrays = await ctx.cache.getTickArrays(tickArrayAddresses, opts);

    const [filteredTickArrays, filteredTickArrayAddresses] = filterNullObjects(
      tickArrays,
      tickArrayAddresses
    );
    return convertListToMap(filteredTickArrays, filteredTickArrayAddresses);
  }

  /**
   * Fetch the decimals to token mapping for the given mints.
   * @param ctx {@link WhirlpoolContext}
   * @param mints The mints to fetch decimals for.
   * @param opts an {@link AccountFetchOpts} object to define fetch and cache options when accessing on-chain accounts
   * @returns A {@link DecimalsMap} of mint addresses to decimals.
   */
  static async fetchDecimalsForMints(
    ctx: WhirlpoolContext,
    mints: Address[],
    opts = PREFER_REFRESH
  ): Promise<DecimalsMap> {
    const mintInfos = Array.from((await ctx.cache.getMintInfos(mints, opts)).values());

    return mintInfos.reduce((acc, mintInfo, index) => {
      const mint = AddressUtil.toString(mints[index]);
      if (!mintInfo) {
        throw new Error(`Mint account does not exist: ${mint}`);
      }

      acc[mint] = mintInfo.decimals;
      return acc;
    }, {} as DecimalsMap);
  }
}
