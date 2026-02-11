import assert from "assert";

export function assertAmountClose(
  expected: bigint,
  actual: bigint,
  tolerance: bigint,
  label: string = "value",
): void {
  const diff = expected > actual ? expected - actual : actual - expected;
  assert.ok(
    diff <= tolerance,
    `Expected ${label} ${actual} to be within ${tolerance} of ${expected}`,
  );
}

export function assertLiquidityClose(
  expected: bigint,
  actual: bigint,
  relativeToleranceBps: bigint,
  minAbsoluteTolerance: bigint,
  label: string = "liquidity",
): void {
  // Combine a percentage tolerance with a fixed floor so small values
  // don't round down to zero tolerance and fail on tiny diffs.
  const tolerance =
    (expected * relativeToleranceBps) / 10_000n + minAbsoluteTolerance;
  assertAmountClose(expected, actual, tolerance, label);
}
