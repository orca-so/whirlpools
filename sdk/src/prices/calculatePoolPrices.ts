import { AddressUtil, DecimalUtil, Percentage } from "@orca-so/common-sdk";
import { Address, BN, translateAddress } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  DecimalsMap,
  defaultConfig,
  defaultThresholdConfig,
  GetPricesConfig,
  PoolMap,
  PriceMap,
  ThresholdConfig,
  TickArrayMap,
  PoolObject,
} from ".";
import { swapQuoteWithParams } from "../quotes/public/swap-quote";
import { TickArray, WhirlpoolData } from "../types/public";
import { PoolUtil, PriceMath, SwapUtils } from "../utils/public";
import { PDAUtil } from "../utils/public/pda-utils";

function convertAmount(
  amount: u64,
  price: Decimal,
  amountDecimal: number,
  resultDecimal: number
): u64 {
  return DecimalUtil.toU64(DecimalUtil.fromU64(amount, amountDecimal).div(price), resultDecimal);
}

/**
 * calculatePoolPrices will calculate the price of each token in the given mints array
 * The price is calculated based on the pool with the highest liquidity
 * In order for the pool to be considered, it must have sufficient liquidity
 * Sufficient liquidity is defined by the thresholdAmount and priceImpactThreshold
 * For example, if the thresholdAmount is 1000 USDC and the priceImpactThreshold is 0.01
 * Then the pool must support 1000 USDC of liquidity without a price impact of 1%
 * In order to calculate sufficient liquidity, the caller of the function must provide
 * the tick arrays required to calculate the price impact
 * @param mints
 * @param poolMap
 * @param tickArrayMap
 * @returns PriceMap
 */
export function calculatePoolPrices(
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
    let amountOut;
    // If the quote token is the first quote token, then the amount out is the threshold amount
    if (quoteToken.equals(config.quoteTokens[0])) {
      amountOut = thresholdConfig.amountOut;
    } else {
      const quoteTokenPrice = results[quoteToken.toBase58()];
      if (!quoteTokenPrice) {
        throw new Error("All quote tokens must have a price against the first quote token");
      }

      amountOut = convertAmount(
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
        amountOut,
        priceImpactThreshold: thresholdConfig.priceImpactThreshold,
      }
    );

    // Populate the price map with any prices that were calculated
    // Use the price of the quote token against the first quote token
    remainingMints.forEach((mint) => {
      // Get the price of the mint token against the quote token
      const mintPrice = prices[mint.toBase58()];
      // Get the price of the quote token against the first quote token
      const quoteTokenPrice = results[quoteToken.toBase58()] || prices[quoteToken.toBase58()];
      if (mintPrice != null && quoteTokenPrice != null) {
        results[mint.toBase58()] = mintPrice.mul(quoteTokenPrice);
      }
    });

    // Filter out any mints that do not have a price
    remainingMints = remainingMints.filter((mint) => results[mint.toBase58()] == null);
  }

  return results;
}

function checkLiquidity(
  pool: WhirlpoolData,
  tickArrays: TickArray[],
  aToB: boolean,
  thresholdConfig: ThresholdConfig,
  decimalsMap: DecimalsMap
): boolean {
  const { amountOut, priceImpactThreshold } = thresholdConfig;

  let estimatedAmountIn;

  try {
    ({ estimatedAmountIn } = swapQuoteWithParams(
      {
        whirlpoolData: pool,
        aToB,
        amountSpecifiedIsInput: false,
        tokenAmount: amountOut,
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(false),
        sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
        tickArrays,
      },
      Percentage.fromDecimal(new Decimal(0))
    ));
  } catch (e) {
    // If a quote could not be generated, assume there is insufficient liquidity
    return false;
  }

  let price, inputDecimals, outputDecimals;
  if (aToB) {
    price = getPrice(pool, decimalsMap);
    inputDecimals = decimalsMap[pool.tokenMintA.toBase58()];
    outputDecimals = decimalsMap[pool.tokenMintB.toBase58()];
  } else {
    price = getPrice(pool, decimalsMap).pow(-1);
    inputDecimals = decimalsMap[pool.tokenMintB.toBase58()];
    outputDecimals = decimalsMap[pool.tokenMintA.toBase58()];
  }

  const amountOutDecimals = DecimalUtil.fromU64(amountOut, outputDecimals);

  const estimatedAmountInDecimals = DecimalUtil.fromU64(estimatedAmountIn, inputDecimals);

  const maxAmountInDecimals = amountOutDecimals
    .div(price)
    .mul(priceImpactThreshold)
    .toDecimalPlaces(inputDecimals);

  return estimatedAmountInDecimals.lte(maxAmountInDecimals);
}

function getMostLiquidPool(
  mintA: Address,
  mintB: Address,
  poolMap: PoolMap,
  config = defaultConfig
): PoolObject | null {
  const { tickSpacings, programId, whirlpoolsConfig } = config;
  const pools = tickSpacings
    .map((tickSpacing) => {
      const pda = PDAUtil.getWhirlpool(
        programId,
        whirlpoolsConfig,
        AddressUtil.toPubKey(mintA),
        AddressUtil.toPubKey(mintB),
        tickSpacing
      );

      return { address: pda.publicKey, pool: poolMap[pda.publicKey.toBase58()] };
    })
    .filter(({ pool }) => pool != null);

  if (pools.length === 0) {
    return null;
  }

  return pools.slice(1).reduce<PoolObject>((acc, { address, pool }) => {
    if (pool.liquidity.lt(acc.pool.liquidity)) {
      return acc;
    }

    return { pool, address };
  }, pools[0]);
}

function calculatePricesForQuoteToken(
  mints: PublicKey[],
  quoteTokenMint: PublicKey,
  poolMap: PoolMap,
  tickArrayMap: TickArrayMap,
  decimalsMap: DecimalsMap,
  config: GetPricesConfig,
  thresholdConfig: ThresholdConfig
): PriceMap {
  return Object.fromEntries(
    mints.map((mint) => {
      if (mint.equals(quoteTokenMint)) {
        return [mint.toBase58(), new Decimal(1)];
      }

      const [mintA, mintB] = PoolUtil.orderMints(mint, quoteTokenMint);

      // The quote token is the output token.
      // Therefore, if the quote token is mintB, then we are swapping from mintA to mintB.
      const aToB = translateAddress(mintB).equals(quoteTokenMint);

      const poolCandidate = getMostLiquidPool(mintA, mintB, poolMap, config);
      if (poolCandidate == null) {
        return [mint.toBase58(), null];
      }

      const { pool, address } = poolCandidate;

      const tickArrays = getTickArrays(pool, address, aToB, tickArrayMap, config);

      const isPoolLiquid = checkLiquidity(pool, tickArrays, aToB, thresholdConfig, decimalsMap);

      if (!isPoolLiquid) {
        return [mint.toBase58(), null];
      }

      const price = getPrice(pool, decimalsMap);
      const quotePrice = aToB ? price : price.pow(-1);
      return [mint.toBase58(), quotePrice];
    })
  );
}

function getTickArrays(
  pool: WhirlpoolData,
  address: PublicKey,
  aToB: boolean,
  tickArrayMap: TickArrayMap,
  config = defaultConfig
): TickArray[] {
  const { programId } = config;
  const tickArrayPublicKeys = SwapUtils.getTickArrayPublicKeys(
    pool.tickCurrentIndex,
    pool.tickSpacing,
    aToB,
    programId,
    address
  );

  return tickArrayPublicKeys.map((tickArrayPublicKey) => {
    return { address: tickArrayPublicKey, data: tickArrayMap[tickArrayPublicKey.toBase58()] };
  });
}

function getPrice(pool: WhirlpoolData, decimalsMap: DecimalsMap) {
  const tokenAAddress = pool.tokenMintA.toBase58();
  const tokenBAddress = pool.tokenMintB.toBase58();
  if (!(tokenAAddress in decimalsMap) || !(tokenBAddress in decimalsMap)) {
    throw new Error("Missing token decimals");
  }

  return PriceMath.sqrtPriceX64ToPrice(
    pool.sqrtPrice,
    decimalsMap[tokenAAddress],
    decimalsMap[tokenBAddress]
  );
}

function isSubset(listA: string[], listB: string[]): boolean {
  return listA.every((itemA) => listB.includes(itemA));
}
