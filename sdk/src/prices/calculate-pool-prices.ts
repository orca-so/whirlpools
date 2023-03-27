import { AddressUtil, DecimalUtil, Percentage } from "@orca-so/common-sdk";
import { Address, translateAddress } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  DecimalsMap,
  defaultGetPricesConfig,
  GetPricesConfig,
  GetPricesThresholdConfig,
  PoolMap,
  PriceMap,
  TickArrayMap,
} from ".";
import { swapQuoteWithParams } from "../quotes/public/swap-quote";
import { TickArray, WhirlpoolData } from "../types/public";
import { PoolUtil, PriceMath, SwapUtils } from "../utils/public";
import { PDAUtil } from "../utils/public/pda-utils";

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

  const amountOutDecimals = DecimalUtil.fromU64(amountOut, outputDecimals);

  const estimatedAmountInDecimals = DecimalUtil.fromU64(estimatedAmountIn, inputDecimals);

  const maxAmountInDecimals = amountOutDecimals
    .div(price)
    .mul(priceImpactThreshold)
    .toDecimalPlaces(inputDecimals);

  return estimatedAmountInDecimals.lte(maxAmountInDecimals);
}

type PoolObject = { pool: WhirlpoolData; address: PublicKey };
function getMostLiquidPool(
  mintA: Address,
  mintB: Address,
  poolMap: PoolMap,
  config = defaultGetPricesConfig
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

export function calculatePricesForQuoteToken(
  mints: Address[],
  quoteTokenMint: PublicKey,
  poolMap: PoolMap,
  tickArrayMap: TickArrayMap,
  decimalsMap: DecimalsMap,
  config: GetPricesConfig,
  thresholdConfig: GetPricesThresholdConfig
): PriceMap {
  return Object.fromEntries(
    mints.map((mintAddr) => {
      const mint = AddressUtil.toPubKey(mintAddr);
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
  amount: u64,
  price: Decimal,
  amountDecimal: number,
  resultDecimal: number
): u64 {
  return DecimalUtil.toU64(DecimalUtil.fromU64(amount, amountDecimal).div(price), resultDecimal);
}
