#[cfg(test)]
pub(crate) fn assert_liquidity_close(
    expected: u128,
    actual: u128,
    relative_tolerance_bps: u128,
    min_absolute_bps: u128,
) {
    let bps_tolerance = expected.saturating_mul(relative_tolerance_bps) / 10_000;
    let tolerance = bps_tolerance.max(min_absolute_bps);
    let diff = if actual >= expected {
        actual - expected
    } else {
        expected - actual
    };
    assert!(
        diff <= tolerance,
        "Position liquidity mismatch! expected={}, got={}, tolerance={}",
        expected,
        actual,
        tolerance
    );
}
