import { MathUtil, ZERO } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { TickArrayData, TickData } from "../types/public";
import { MAX_SWAP_TICK_ARRAYS, TICK_ARRAY_SIZE } from "../types/public";
import { PDAUtil, TickUtil } from "./public";

export function getLowerSqrtPriceFromTokenA(
  amount: BN,
  liquidity: BN,
  sqrtPriceX64: BN,
): BN {
  const numerator = liquidity.mul(sqrtPriceX64).shln(64);
  const denominator = liquidity.shln(64).add(amount.mul(sqrtPriceX64));

  // always round up
  return MathUtil.divRoundUp(numerator, denominator);
}

export function getUpperSqrtPriceFromTokenA(
  amount: BN,
  liquidity: BN,
  sqrtPriceX64: BN,
): BN {
  const numerator = liquidity.mul(sqrtPriceX64).shln(64);
  const denominator = liquidity.shln(64).sub(amount.mul(sqrtPriceX64));

  // always round up
  return MathUtil.divRoundUp(numerator, denominator);
}

export function getLowerSqrtPriceFromTokenB(
  amount: BN,
  liquidity: BN,
  sqrtPriceX64: BN,
): BN {
  // always round down
  return sqrtPriceX64.sub(MathUtil.divRoundUp(amount.shln(64), liquidity));
}

export function getUpperSqrtPriceFromTokenB(
  amount: BN,
  liquidity: BN,
  sqrtPriceX64: BN,
): BN {
  // always round down (rounding up a negative number)
  return sqrtPriceX64.add(amount.shln(64).div(liquidity));
}

export type TickArrayAddress = { pubkey: PublicKey; startTickIndex: number };

export function getTickArrayPublicKeysWithStartTickIndex(
  tickCurrentIndex: number,
  tickSpacing: number,
  aToB: boolean,
  programId: PublicKey,
  whirlpoolAddress: PublicKey,
): TickArrayAddress[] {
  const shift = aToB ? 0 : tickSpacing;

  let offset = 0;
  let tickArrayAddresses: TickArrayAddress[] = [];
  for (let i = 0; i < MAX_SWAP_TICK_ARRAYS; i++) {
    let startIndex: number;
    try {
      startIndex = TickUtil.getStartTickIndex(
        tickCurrentIndex + shift,
        tickSpacing,
        offset,
      );
    } catch {
      return tickArrayAddresses;
    }

    const pda = PDAUtil.getTickArray(programId, whirlpoolAddress, startIndex);
    tickArrayAddresses.push({
      pubkey: pda.publicKey,
      startTickIndex: startIndex,
    });
    offset = aToB ? offset - 1 : offset + 1;
  }

  return tickArrayAddresses;
}

export const ZEROED_TICK_DATA: TickData = Object.freeze({
  initialized: false,
  liquidityNet: ZERO,
  liquidityGross: ZERO,
  feeGrowthOutsideA: ZERO,
  feeGrowthOutsideB: ZERO,
  rewardGrowthsOutside: [ZERO, ZERO, ZERO],
});

export const ZEROED_TICKS: TickData[] = Array.from(
  { length: TICK_ARRAY_SIZE },
  () => ZEROED_TICK_DATA,
);

export function buildZeroedTickArray(
  whirlpool: PublicKey,
  startTickIndex: number,
): TickArrayData {
  return {
    startTickIndex,
    ticks: ZEROED_TICKS,
    whirlpool,
  };
}
