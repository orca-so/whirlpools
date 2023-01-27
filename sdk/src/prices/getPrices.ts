// liquidityThresholdCheck
// params: pool, tick arrays, amount threshold, price impact threshold
// Given a pool and tick arrays, check if there is sufficient liquidity

import { Percentage } from "@orca-so/common-sdk";
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

// getPriceForQuoteToken
// params: mint addresses, base token mint address
// 1. Derive X/Y pool addresses for each mint address and base token
// 2. Fetch pool accounts
// 3. Use pool with highest liquidity
// 4. Fetch tick arrays for the pool
// 5. Run liquidityThresholdCheck
// 6. If pass use price
// 7. If fail, return null

type PoolMap = { [key: string]: WhirlpoolData };
type TickArrayMap = { [key: string]: TickArrayData };
type PriceMap = { [key: string]: Decimal | null };
type TickSpacingAccumulator = null | { pool: WhirlpoolData; address: PublicKey };

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
          const pda = PDAUtil.getWhirlpool(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            ORCA_WHIRLPOOLS_CONFIG,
            mint,
            baseTokenMint,
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

// getPoolPrice
// params: mint addresses, pools (including SOL/USDC), tick arrays
// 1. Run getPriceForQuoteToken with USDC
// 2. Filter mints without a price
// 3. Run getPriceForQuoteToken with SOL
// 4. Fetch SOL price
// 5. Return prices

const USDC_THRESHOLD_AMOUNT = new BN(1_000_000_000);
const PRICE_IMPACT_THRESHOLD = 1.05;

// TODO: Auto-generate based on SOL price
const SOL_THRESHOLD_AMOUNT = new BN(20_000_000_000);

function getPoolPrices(mints: PublicKey[], poolMap: PoolMap, tickArrayMap: TickArrayMap) {
  const mintSet = new Set(mints.map((mint) => mint.toBase58()));
  mintSet.add(TOKEN_MINTS["SOL"]);
  mintSet.delete(TOKEN_MINTS["USDC"]);

  const prices = getPriceForQuoteToken(
    Array.from(mintSet).map((mint) => new PublicKey(mint)),
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
    Array.from(solMintSet).map((mint) => new PublicKey(mint)),
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
