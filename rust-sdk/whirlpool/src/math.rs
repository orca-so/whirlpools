use orca_whirlpools_core::{BPS_DENOMINATOR, MAX_SQRT_PRICE, MIN_SQRT_PRICE};

/// Precision scale for sqrt of (10000 ± bps). sqrt(radicand * SLIPPAGE_PRECISION) yields scale
/// factors with 3 extra decimal places vs sqrt(radicand).
const SLIPPAGE_PRECISION: u128 = 1_000_000;

/// Scaling factor for sqrt-price slippage.
const SQRT_SLIPPAGE_DENOMINATOR: u128 = 100_000;

/// Integer square root using Newton's method (floor of sqrt).
fn sqrt_u128(value: u128) -> u128 {
    if value < 2 {
        return value;
    }
    let mut prev = value / 2;
    let mut next = (prev + value / prev) / 2;
    while next < prev {
        prev = next;
        next = (prev + value / prev) / 2;
    }
    prev
}

/// Ceiling of integer square root.
fn sqrt_u128_ceil(value: u128) -> u128 {
    let floor = sqrt_u128(value);
    if floor.saturating_mul(floor) < value {
        floor + 1
    } else {
        floor
    }
}

/// Computes min/max sqrt-price bounds for slippage protection.
///
/// Cap: `slippage_tolerance_bps` is clamped to BPS_DENOMINATOR (10_000) so the radicands
/// `(10000 ± bps)` stay non-negative and we never take sqrt of a negative.
pub fn get_sqrt_price_slippage_bounds(
    sqrt_price: u128,
    slippage_tolerance_bps: u16,
) -> (u128, u128) {
    let capped_bps = slippage_tolerance_bps.min(BPS_DENOMINATOR); // scaling factor: 10_000
    let bps = u128::from(capped_bps); // scaling factor: 10_000
    let bps_denominator = u128::from(BPS_DENOMINATOR); // scaling factor: 10_000
    let lower_radicand = (bps_denominator - bps) * SLIPPAGE_PRECISION; // scaling factor: 10_000 * 1_000_000 = 10_000_000_000
    let upper_radicand = (bps_denominator + bps) * SLIPPAGE_PRECISION; // scaling factor: 10_000_000_000
    let lower_factor = sqrt_u128(lower_radicand); // scaling factor: 100_000
    let upper_factor = sqrt_u128_ceil(upper_radicand); // scaling factor: 100_000

    let scale = |factor: u128| sqrt_price.saturating_mul(factor) / SQRT_SLIPPAGE_DENOMINATOR;
    let min_sqrt_price = scale(lower_factor).max(MIN_SQRT_PRICE); // scaling factor: 1
    let max_sqrt_price = scale(upper_factor).min(MAX_SQRT_PRICE); // scaling factor: 1
    (min_sqrt_price, max_sqrt_price)
}

#[cfg(test)]
mod tests {
    use approx::assert_relative_eq;
    use orca_whirlpools_core::{price_to_sqrt_price, sqrt_price_to_price};
    use rstest::rstest;

    use crate::math::get_sqrt_price_slippage_bounds;

    #[rstest]
    #[case(0)]
    #[case(1)]
    #[case(10)]
    #[case(50)]
    #[case(100)]
    #[case(200)]
    #[case(500)]
    #[case(1000)]
    #[case(5000)]
    fn slippage_symmetry(#[case] slippage_bps: u16) {
        let price = 1_000_000.0_f64;
        let sqrt_price: u128 = price_to_sqrt_price(price, 6, 6);
        assert_eq!(sqrt_price, 18446744073709551616000);

        let (min_sqrt_price, max_sqrt_price) =
            get_sqrt_price_slippage_bounds(sqrt_price, slippage_bps);

        let actual_min = sqrt_price_to_price(min_sqrt_price, 6, 6);
        let actual_max = sqrt_price_to_price(max_sqrt_price, 6, 6);

        let expected_min = price * (10_000.0 - slippage_bps as f64) / 10_000.0;
        let expected_max = price * (10_000.0 + slippage_bps as f64) / 10_000.0;

        assert_relative_eq!(actual_min, expected_min, max_relative = 0.0001);
        assert_relative_eq!(actual_max, expected_max, max_relative = 0.0001);
    }
}
