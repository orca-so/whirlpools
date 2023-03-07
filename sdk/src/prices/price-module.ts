import { AddressUtil } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import {
  DecimalsMap,
  defaultConfig,
  defaultThresholdConfig,
  PoolMap,
  PriceMap,
  TickArrayMap,
} from ".";
import { WhirlpoolContext } from "../context";
import { PDAUtil, PoolUtil, SwapUtils } from "../utils/public";
import { convertListToMap, filterNullObjects } from "../utils/txn-utils";
import { calculatePricesForQuoteToken, convertAmount, isSubset } from "./calculate-pool-prices";

export class PriceModule {
  // fetchPoolPrices performs both the network requests and the price calculation logic
  // If the caller already has the necessary data, they can use calculatePoolPrices
  // If the caller has some of the data but not others, they can call individual fetch* functions
  static async fetchPoolPrices(
    ctx: WhirlpoolContext,
    mints: PublicKey[],
    config = defaultConfig,
    thresholdConfig = defaultThresholdConfig,
    refresh = true
  ): Promise<PriceMap> {
    const { poolMap, tickArrayMap, decimalsMap } = await PriceModule.fetchPriceCalculationData(
      ctx,
      mints,
      config,
      refresh
    );

    return PriceModule.calculatePoolPrices(
      mints,
      poolMap,
      tickArrayMap,
      decimalsMap,
      config,
      thresholdConfig
    );
  }

  static async fetchPriceCalculationData(
    ctx: WhirlpoolContext,
    mints: PublicKey[],
    config = defaultConfig,
    refresh = true
  ) {
    const poolMap = await PriceModule.fetchPoolsForMints(ctx, mints, config, refresh);
    const tickArrayMap = await PriceModule.fetchTickArraysForPools(ctx, poolMap, config, refresh);
    const decimalsMap = await PriceModule.fetchDecimalsForMints(ctx, mints, refresh);

    return { poolMap, tickArrayMap, decimalsMap };
  }

  static async fetchPoolsForMints(
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

  static async fetchTickArraysForPools(
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
        if (aToBTickArrayPublicKeys[0].equals(bToATickArrayPublicKeys[0])) {
          return aToBTickArrayPublicKeys.concat(bToATickArrayPublicKeys.slice(1));
        } else {
          return aToBTickArrayPublicKeys.concat(bToATickArrayPublicKeys);
        }
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

  static async fetchDecimalsForMints(
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

  /**
   * calculatePoolPrices will calculate the price of each token in the mints array.
   * Each token will be priced against the first quote token in the config.quoteTokens array
   * with sufficient liquidity. If a token does not have sufficient liquidity against the
   * first quote token, then it will be priced against the next quote token in the array.
   * If a token does not have sufficient liquidity against any quote token,
   * then the price will be set to null.
   * The threshold for "sufficient liquidity" is defined by the thresholdConfig parameter.
   *
   * The caller of the function must provide the accounts through the following parameters:
   *  - poolMap: A map of pool addresses to pool data
   *  - tickArrayMap: A map of pool addresses to tick array data
   *  - decimalsMap: A map of token mint addresses to token decimals
   *
   * fetchPoolPrices.ts provides functions to fetch these accounts
   */
  static calculatePoolPrices(
    mints: PublicKey[],
    poolMap: PoolMap,
    tickArrayMap: TickArrayMap,
    decimalsMap: DecimalsMap,
    config = defaultConfig,
    thresholdConfig = defaultThresholdConfig
  ): PriceMap {
    // Ensure that quote tokens are in the mints array
    if (
      !isSubset(
        config.quoteTokens.map((mint) => mint.toBase58()),
        mints.map((mint) => mint.toBase58())
      )
    ) {
      throw new Error("Quote tokens must be in mints array");
    }

    const results: PriceMap = Object.fromEntries(mints.map((mint) => [mint, null]));

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
        const quoteTokenPrice = results[quoteToken.toBase58()];
        if (!quoteTokenPrice) {
          throw new Error("All quote tokens must have a price against the first quote token");
        }

        amountOutThresholdAgainstFirstQuoteToken = convertAmount(
          thresholdConfig.amountOut,
          quoteTokenPrice,
          decimalsMap[config.quoteTokens[0].toBase58()],
          decimalsMap[quoteToken.toBase58()]
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
      remainingMints.forEach((mint) => {
        const mintPrice = prices[mint.toBase58()];
        if (mintPrice != null && quoteTokenPrice != null) {
          results[mint.toBase58()] = mintPrice.mul(quoteTokenPrice);
        }
      });

      // Filter out any mints that do not have a price
      remainingMints = remainingMints.filter((mint) => results[mint.toBase58()] == null);
    }

    return results;
  }
}
