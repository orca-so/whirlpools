import { PriceMath } from "@orca-so/whirlpools-sdk";
import BN from "bn.js";

export function calcDepositRatio(
  currSqrtPriceX64: BN,
  lowerSqrtPriceX64: BN,
  upperSqrtPriceX64: BN,
  decimalsA: number,
  decimalsB: number,
): [number, number] {
  const clampedSqrtPriceX64 = BN.min(
    BN.max(currSqrtPriceX64, lowerSqrtPriceX64),
    upperSqrtPriceX64,
  );

  const clampedSqrtPrice = PriceMath.sqrtPriceX64ToPrice(
    clampedSqrtPriceX64,
    decimalsA,
    decimalsB,
  ).sqrt();
  const lowerSqrtPrice = PriceMath.sqrtPriceX64ToPrice(
    lowerSqrtPriceX64,
    decimalsA,
    decimalsB,
  ).sqrt();
  const upperSqrtPrice = PriceMath.sqrtPriceX64ToPrice(
    upperSqrtPriceX64,
    decimalsA,
    decimalsB,
  ).sqrt();

  const currPrice = PriceMath.sqrtPriceX64ToPrice(
    currSqrtPriceX64,
    decimalsA,
    decimalsB,
  );

  // calc ratio (L: liquidity)
  // depositA = L/currSqrtPrice - L/upperSqrtPrice
  // depositB = L*currSqrtPrice - L*lowerSqrtPrice
  const depositA = upperSqrtPrice
    .sub(clampedSqrtPrice)
    .div(clampedSqrtPrice.mul(upperSqrtPrice));
  const depositB = clampedSqrtPrice.sub(lowerSqrtPrice);

  const depositAValueInB = depositA.mul(currPrice);
  const depositBValueInB = depositB;
  const totalValueInB = depositAValueInB.add(depositBValueInB);

  const ratioA = depositAValueInB.div(totalValueInB).mul(100);
  const ratioB = depositBValueInB.div(totalValueInB).mul(100);

  return [ratioA.toNumber(), ratioB.toNumber()];
}
