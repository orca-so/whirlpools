import { AddressUtil, Percentage } from "@orca-so/common-sdk";
import { BN, translateAddress } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { swapQuoteWithParams } from "../quotes/public/swap-quote";
import {
  ORCA_SUPPORTED_TICK_SPACINGS,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  TickArray,
  TickArrayData,
  TOKEN_MINTS,
  WhirlpoolData,
} from "../types/public";
import { PoolUtil, SwapUtils } from "../utils/public";
import { PDAUtil } from "../utils/public/pda-utils";

export type PoolMap = Record<string, WhirlpoolData>;
export type TickArrayMap = { [key: string]: TickArrayData };
export type PriceMap = { [key: string]: Decimal | null };
export type TickSpacingAccumulator = null | { pool: WhirlpoolData; address: PublicKey };

const USDC_THRESHOLD_AMOUNT = new BN(1_000_000_000);
const PRICE_IMPACT_THRESHOLD = 1.05;

// TODO: Auto-generate based on SOL price
const SOL_THRESHOLD_AMOUNT = new BN(20_000_000_000);

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
  tickArrayMap: TickArrayMap
): PriceMap {
  mints = cleanMints(mints);

  const prices = getPriceForQuoteToken(
    mints.concat(new PublicKey(TOKEN_MINTS["SOL"])),
    new PublicKey(TOKEN_MINTS["USDC"]),
    poolMap,
    tickArrayMap,
    USDC_THRESHOLD_AMOUNT,
    PRICE_IMPACT_THRESHOLD
  );

  const filteredMints = mints.filter((mint) => prices[mint.toBase58()] !== null);
  const solMintSet = new Set(filteredMints.map((mint) => mint.toBase58()));
  solMintSet.delete(TOKEN_MINTS["SOL"]);
  solMintSet.delete(TOKEN_MINTS["USDC"]);

  const solPrices = getPriceForQuoteToken(
    mints,
    new PublicKey(TOKEN_MINTS["SOL"]),
    poolMap,
    tickArrayMap,
    SOL_THRESHOLD_AMOUNT,
    PRICE_IMPACT_THRESHOLD
  );

  // Get SOL price, convert into USDC price
  const solPrice = prices[TOKEN_MINTS["SOL"]];
  if (!solPrice) {
    return prices;
  }

  Object.entries(prices).forEach(([mint, price]) => {
    if (price != null || solPrices[mint] === null) {
      return;
    }

    const solPriceForMint = solPrices[mint];
    if (!solPriceForMint) {
      return;
    }

    prices[mint] = solPriceForMint.mul(solPrice);
  });

  return prices;
}

function liquidityThresholdCheck(
  pool: WhirlpoolData,
  tickArrays: TickArray[],
  isTokenA: boolean,
  amount: BN,
  priceImpactThreshold: number
): boolean {
  const { estimatedAmountOut } = swapQuoteWithParams(
    {
      whirlpoolData: pool,
      aToB: isTokenA,
      amountSpecifiedIsInput: true,
      tokenAmount: amount,
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(true),
      tickArrays,
    },
    Percentage.fromDecimal(new Decimal(0))
  );

  const amountOutThreshold = new BN(
    new Decimal(amount.toString())
      .mul(new Decimal(pool.sqrtPrice.toString()).pow(2))
      .div(priceImpactThreshold)
      .toString()
  );

  return estimatedAmountOut.lt(amountOutThreshold);

  // TODO: Calculate the opposite direction
}

function getPriceForQuoteToken(
  mints: PublicKey[],
  baseTokenMint: PublicKey,
  poolMap: PoolMap,
  tickArrayMap: TickArrayMap,
  thresholdAmount: BN,
  priceImpactThreshold: number
): PriceMap {
  return Object.fromEntries(
    mints.map((mint) => {
      const acc = ORCA_SUPPORTED_TICK_SPACINGS.reduce<TickSpacingAccumulator>(
        (acc, tickSpacing) => {
          const [mintA, mintB] = PoolUtil.orderMints(mint, baseTokenMint);
          const pda = PDAUtil.getWhirlpool(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            ORCA_WHIRLPOOLS_CONFIG,
            AddressUtil.toPubKey(mintA),
            AddressUtil.toPubKey(mintB),
            tickSpacing
          );

          const pool = poolMap[pda.publicKey.toBase58()];
          if (!pool || (acc && pool.liquidity.lt(acc.pool.liquidity))) {
            return acc;
          }

          return { pool, address: pda.publicKey };
        },
        null
      );

      if (!acc) {
        return [mint, null];
      }

      const { pool, address } = acc;

      const tickArrayPublicKeys = SwapUtils.getTickArrayPublicKeys(
        pool.tickCurrentIndex,
        pool.tickSpacing,
        true,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        address
      );

      const tickArrays = tickArrayPublicKeys.map((tickArrayPublicKey) => {
        return { address: tickArrayPublicKey, data: tickArrayMap[tickArrayPublicKey.toBase58()] };
      });

      const [mintA] = PoolUtil.orderMints(mint, baseTokenMint);
      const isPriceInverted = baseTokenMint.toBase58() === translateAddress(mintA).toBase58();
      const thresholdPassed = liquidityThresholdCheck(
        pool,
        tickArrays,
        isPriceInverted,
        thresholdAmount,
        priceImpactThreshold
      );

      if (!thresholdPassed) {
        return [mint, null];
      }

      const price = new Decimal(pool.sqrtPrice.toString()).pow(2);
      return [mint, isPriceInverted ? price.pow(-1) : price];
    })
  );
}

function cleanMints(mints: PublicKey[]): PublicKey[] {
  const mintSet = new Set(mints.map((mint) => mint.toBase58()));
  mintSet.delete(TOKEN_MINTS["SOL"]);
  mintSet.delete(TOKEN_MINTS["USDC"]);
  return Array.from(mintSet).map((mint) => new PublicKey(mint));
}
