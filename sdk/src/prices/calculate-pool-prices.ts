import { Address } from "@coral-xyz/anchor";
import { AddressUtil, DecimalUtil, Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  DecimalsMap,
  GetPricesConfig,
  GetPricesThresholdConfig,
  PoolMap,
  PriceMap,
  TickArrayMap,
  defaultGetPricesConfig,
} from ".";
import { swapQuoteWithParams } from "../quotes/public/swap-quote";
import { TickArray, WhirlpoolData } from "../types/public";
import { PoolUtil, PriceMath, SwapUtils } from "../utils/public";

function checkLiquidity(
  pool: WhirlpoolData,
  tickArrays: TickArray[],
  aToB: boolean,
  thresholdConfig: GetPricesThresholdConfig,
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

  // Calculate the maximum amount in that is allowed against the desired output
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

  const amountOutDecimals = DecimalUtil.fromBN(amountOut, outputDecimals);

  const estimatedAmountInDecimals = DecimalUtil.fromBN(estimatedAmountIn, inputDecimals);

  const maxAmountInDecimals = amountOutDecimals
    .div(price)
    .mul(priceImpactThreshold)
    .toDecimalPlaces(inputDecimals);

  return estimatedAmountInDecimals.lte(maxAmountInDecimals);
}

type PoolObject = { pool: WhirlpoolData; address: PublicKey };
function getMostLiquidPools(
  quoteTokenMint: PublicKey,
  poolMap: PoolMap
): Record<string, PoolObject> {
  const mostLiquidPools = new Map<string, PoolObject>();
  Object.entries(poolMap).forEach(([address, pool]) => {
    const mintA = pool.tokenMintA.toBase58();
    const mintB = pool.tokenMintB.toBase58();

    if (pool.liquidity.isZero()) {
      return;
    }
    if (!pool.tokenMintA.equals(quoteTokenMint) && !pool.tokenMintB.equals(quoteTokenMint)) {
      return;
    }

    const baseTokenMint = pool.tokenMintA.equals(quoteTokenMint) ? mintB : mintA;

    const existingPool = mostLiquidPools.get(baseTokenMint);
    if (!existingPool || pool.liquidity.gt(existingPool.pool.liquidity)) {
      mostLiquidPools.set(baseTokenMint, { address: AddressUtil.toPubKey(address), pool });
    }
  });

  return Object.fromEntries(mostLiquidPools);
}

export function calculatePricesForQuoteToken(
  mints: Address[],
  quoteTokenMint: PublicKey,
  poolMap: PoolMap,
  tickArrayMap: TickArrayMap,
  decimalsMap: DecimalsMap,
  config: GetPricesConfig,
  thresholdConfig: GetPricesThresholdConfig
): PriceMap {
  const mostLiquidPools = getMostLiquidPools(quoteTokenMint, poolMap);

  return Object.fromEntries(
    mints.map((mintAddr) => {
      const mint = AddressUtil.toPubKey(mintAddr);
      if (mint.equals(quoteTokenMint)) {
        return [mint.toBase58(), new Decimal(1)];
      }

      const [mintA, mintB] = PoolUtil.orderMints(mint, quoteTokenMint);

      // The quote token is the output token.
      // Therefore, if the quote token is mintB, then we are swapping from mintA to mintB.
      const aToB = AddressUtil.toPubKey(mintB).equals(quoteTokenMint);

      const baseTokenMint = aToB ? mintA : mintB;
      const poolCandidate = mostLiquidPools[AddressUtil.toString(baseTokenMint)];
      if (poolCandidate === undefined) {
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
  config = defaultGetPricesConfig
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

export function isSubset(listA: string[], listB: string[]): boolean {
  return listA.every((itemA) => listB.includes(itemA));
}

export function convertAmount(
  amount: BN,
  price: Decimal,
  amountDecimal: number,
  resultDecimal: number
): BN {
  return DecimalUtil.toBN(DecimalUtil.fromBN(amount, amountDecimal).div(price), resultDecimal);
}
