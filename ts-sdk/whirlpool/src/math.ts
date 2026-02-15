import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "./constants";

const SLIPPAGE_BPS_DENOMINATOR = 10_000n;

/** Precision scale for sqrt of (10000 ± bps). sqrt(radicand * SLIPPAGE_PRECISION)
 * yields scale factors with 3 extra decimal places vs sqrt(radicand). */
const SLIPPAGE_PRECISION = 1_000_000n;

/** Scaling factor for sqrt-price slippage. */
const SQRT_SLIPPAGE_DENOMINATOR = 100_000n;

/** Integer square root using Newton's method (floor of sqrt). */
function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error("sqrtBigInt value must be non-negative");
  }
  if (value < 2n) {
    return value;
  }
  let prev = value / 2n;
  let next = (prev + value / prev) / 2n;
  while (next < prev) {
    prev = next;
    next = (prev + value / prev) / 2n;
  }
  return prev;
}

/** Ceiling of integer square root. */
function sqrtBigIntCeil(value: bigint): bigint {
  const floor = sqrtBigInt(value);
  if (floor * floor < value) {
    return floor + 1n;
  }
  return floor;
}

/**
 * Computes min/max sqrt-price bounds for slippage protection.
 *
 * Cap: `slippage_tolerance_bps` is clamped to BPS_DENOMINATOR (10_000) so the radicands
 * `(10000 ± bps)` stay non-negative and we never take sqrt of a negative.
 */
export function getSqrtPriceSlippageBounds(
  sqrtPrice: bigint,
  slippageToleranceBps: number,
): { minSqrtPrice: bigint; maxSqrtPrice: bigint } {
  const boundedBps = BigInt(
    Math.max(
      0,
      Math.min(slippageToleranceBps, Number(SLIPPAGE_BPS_DENOMINATOR)),
    ),
  ); // scaling factor: 10_000
  const lowerRadicand =
    (SLIPPAGE_BPS_DENOMINATOR - boundedBps) * SLIPPAGE_PRECISION; // scaling factor: 10_000 * 1_000_000 = 10_000_000_000
  const upperRadicand =
    (SLIPPAGE_BPS_DENOMINATOR + boundedBps) * SLIPPAGE_PRECISION; // scaling factor: 10_000_000_000
  const lowerFactor = sqrtBigInt(lowerRadicand); // scaling factor: 100_000
  const upperFactor = sqrtBigIntCeil(upperRadicand); // scaling factor: 100_000

  const scale = (factor: bigint) =>
    (sqrtPrice * factor) / SQRT_SLIPPAGE_DENOMINATOR;
  const scaledMin = scale(lowerFactor); // scaling factor: 1
  const scaledMax = scale(upperFactor); // scaling factor: 1

  return {
    minSqrtPrice: scaledMin > MIN_SQRT_PRICE ? scaledMin : MIN_SQRT_PRICE,
    maxSqrtPrice: scaledMax < MAX_SQRT_PRICE ? scaledMax : MAX_SQRT_PRICE,
  };
}
