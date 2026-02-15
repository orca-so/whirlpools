#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use libm::{floor, pow, sqrt};

use super::{invert_tick_index, sqrt_price_to_tick_index, tick_index_to_sqrt_price};
use crate::{BPS_DENOMINATOR, MAX_SQRT_PRICE, MIN_SQRT_PRICE, U128};

const Q64_RESOLUTION: f64 = 18446744073709551616.0;

/// Precision scale for sqrt of (10000 ± bps).
///
/// sqrt(radicand * SLIPPAGE_PRECISION) yields scale factors with 3 extra decimal places
/// vs sqrt(radicand).
const SLIPPAGE_PRECISION: u128 = 1_000_000;

/// Scaling factor for sqrt-price slippage.
const SQRT_SLIPPAGE_DENOMINATOR: u128 = 100_000;

/// Integer square root using Newton's method (floor of sqrt).
///
/// # Parameters
/// * `value` - The value to take the square root of
///
/// # Returns
/// * `u128` - The floor of the square root
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
///
/// # Parameters
/// * `value` - The value to take the square root of
///
/// # Returns
/// * `u128` - The ceiling of the square root
fn sqrt_u128_ceil(value: u128) -> u128 {
    let floor = sqrt_u128(value);
    if floor.saturating_mul(floor) < value {
        floor + 1
    } else {
        floor
    }
}

/// Convert a price into a sqrt priceX64
/// IMPORTANT: floating point operations can reduce the precision of the result.
/// Make sure to do these operations last and not to use the result for further calculations.
///
/// # Parameters
/// * `price` - The price to convert
/// * `decimals_a` - The number of decimals of the base token
/// * `decimals_b` - The number of decimals of the quote token
///
/// # Returns
/// * `u128` - The sqrt priceX64
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn price_to_sqrt_price(price: f64, decimals_a: u8, decimals_b: u8) -> U128 {
    let power = pow(10f64, decimals_a as f64 - decimals_b as f64);
    (floor(sqrt(price / power) * Q64_RESOLUTION) as u128).into()
}

/// Convert a sqrt priceX64 into a tick index
/// IMPORTANT: floating point operations can reduce the precision of the result.
/// Make sure to do these operations last and not to use the result for further calculations.
///
/// # Parameters
/// * `sqrt_price` - The sqrt priceX64 to convert
/// * `decimals_a` - The number of decimals of the base token
/// * `decimals_b` - The number of decimals of the quote token
///
/// # Returns
/// * `f64` - The decimal price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn sqrt_price_to_price(sqrt_price: U128, decimals_a: u8, decimals_b: u8) -> f64 {
    let power = pow(10f64, decimals_a as f64 - decimals_b as f64);
    let sqrt_price: u128 = sqrt_price.into();
    let sqrt_price_u128 = sqrt_price as f64;
    pow(sqrt_price_u128 / Q64_RESOLUTION, 2.0) * power
}

/// Invert a price
/// IMPORTANT: floating point operations can reduce the precision of the result.
/// Make sure to do these operations last and not to use the result for further calculations.
///
/// # Parameters
/// * `price` - The price to invert
/// * `decimals_a` - The number of decimals of the base token
/// * `decimals_b` - The number of decimals of the quote token
///
/// # Returns
/// * `f64` - The inverted price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn invert_price(price: f64, decimals_a: u8, decimals_b: u8) -> f64 {
    let tick_index = price_to_tick_index(price, decimals_a, decimals_b);
    let inverted_tick_index = invert_tick_index(tick_index);
    tick_index_to_price(inverted_tick_index, decimals_a, decimals_b)
}

/// Convert a tick index into a price
/// IMPORTANT: floating point operations can reduce the precision of the result.
/// Make sure to do these operations last and not to use the result for further calculations.
///
/// # Parameters
/// * `tick_index` - The tick index to convert
/// * `decimals_a` - The number of decimals of the base token
/// * `decimals_b` - The number of decimals of the quote token
///
/// # Returns
/// * `f64` - The decimal price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn tick_index_to_price(tick_index: i32, decimals_a: u8, decimals_b: u8) -> f64 {
    let sqrt_price = tick_index_to_sqrt_price(tick_index);
    sqrt_price_to_price(sqrt_price, decimals_a, decimals_b)
}

/// Convert a price into a tick index
/// IMPORTANT: floating point operations can reduce the precision of the result.
/// Make sure to do these operations last and not to use the result for further calculations.
///
/// # Parameters
/// * `price` - The price to convert
/// * `decimals_a` - The number of decimals of the base token
/// * `decimals_b` - The number of decimals of the quote token
///
/// # Returns
/// * `i32` - The tick index
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn price_to_tick_index(price: f64, decimals_a: u8, decimals_b: u8) -> i32 {
    let sqrt_price = price_to_sqrt_price(price, decimals_a, decimals_b);
    sqrt_price_to_tick_index(sqrt_price)
}

/// Min/max sqrt-price bounds for slippage protection.
///
/// # Fields
/// * `min_sqrt_price` - The minimum sqrt price (lower bound)
/// * `max_sqrt_price` - The maximum sqrt price (upper bound)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct SqrtPriceSlippageBounds {
    pub min_sqrt_price: u128,
    pub max_sqrt_price: u128,
}

/// Computes min/max sqrt-price bounds for slippage protection.
///
/// Cap: `slippage_tolerance_bps` is clamped to BPS_DENOMINATOR (10_000) so the radicands
/// `(10000 ± bps)` stay non-negative and we never take sqrt of a negative.
///
/// # Parameters
/// * `sqrt_price` - The current sqrt priceX64
/// * `slippage_tolerance_bps` - The slippage tolerance in basis points
///
/// # Returns
/// * `SqrtPriceSlippageBounds` - The min and max sqrt price bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_sqrt_price_slippage_bounds(
    sqrt_price: U128,
    slippage_tolerance_bps: u16,
) -> SqrtPriceSlippageBounds {
    let sqrt_price: u128 = sqrt_price.into();
    let capped_bps = slippage_tolerance_bps.min(BPS_DENOMINATOR);
    let bps = u128::from(capped_bps);
    let bps_denominator = u128::from(BPS_DENOMINATOR);
    let lower_radicand = (bps_denominator - bps) * SLIPPAGE_PRECISION;
    let upper_radicand = (bps_denominator + bps) * SLIPPAGE_PRECISION;
    let lower_factor = sqrt_u128(lower_radicand);
    let upper_factor = sqrt_u128_ceil(upper_radicand);

    let scale = |factor: u128| sqrt_price.saturating_mul(factor) / SQRT_SLIPPAGE_DENOMINATOR;
    let min_sqrt_price = scale(lower_factor).max(MIN_SQRT_PRICE);
    let max_sqrt_price = scale(upper_factor).min(MAX_SQRT_PRICE);

    SqrtPriceSlippageBounds {
        min_sqrt_price,
        max_sqrt_price,
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use approx::assert_relative_eq;

    use super::*;

    #[test]
    fn test_price_to_sqrt_price() {
        assert_eq!(price_to_sqrt_price(0.00999999, 8, 6), 184467348503352096);
        assert_eq!(price_to_sqrt_price(100.0, 6, 6), 184467440737095516160);
        assert_eq!(price_to_sqrt_price(100.0111, 6, 8), 1844776783959692673024);
    }

    #[test]
    fn test_sqrt_price_to_price() {
        assert_relative_eq!(sqrt_price_to_price(184467348503352096, 8, 6), 0.00999999);
        assert_relative_eq!(sqrt_price_to_price(184467440737095516160, 6, 6), 100.0);
        assert_relative_eq!(sqrt_price_to_price(1844776783959692673024, 6, 8), 100.0111);
    }

    #[test]
    fn test_invert_price() {
        assert_relative_eq!(
            invert_price(0.00999999, 8, 6),
            1000099.11863,
            epsilon = 1e-5
        );
        assert_relative_eq!(invert_price(100.0, 6, 6), 0.01, epsilon = 1e-5);
        assert_relative_eq!(invert_price(100.0111, 6, 8), 9.99e-7, epsilon = 1e-5);
    }

    #[test]
    fn test_tick_index_to_price() {
        assert_relative_eq!(tick_index_to_price(-92111, 8, 6), 0.009998, epsilon = 1e-5);
        assert_relative_eq!(tick_index_to_price(0, 6, 6), 1.0);
        assert_relative_eq!(tick_index_to_price(92108, 6, 8), 99.999912, epsilon = 1e-5);
    }

    #[test]
    fn test_price_to_tick_index() {
        assert_eq!(price_to_tick_index(0.009998, 8, 6), -92111);
        assert_eq!(price_to_tick_index(1.0, 6, 6), 0);
        assert_eq!(price_to_tick_index(99.999912, 6, 8), 92108);
    }

    #[test]
    fn test_sol_usdc() {
        let sqrt_price = 6918418495991757039u128; // 140.661 USDC/SOL
        let decimals_a = 9u8; // SOL
        let decimals_b = 6u8; // USDC
        let price = sqrt_price_to_price(sqrt_price, decimals_a, decimals_b);
        assert_eq!(price, 140.66116595692344);
        let sqrt_price_back = price_to_sqrt_price(price, decimals_a, decimals_b);
        let diff = (sqrt_price_back as i128) - (sqrt_price as i128);
        let diff_rate = (diff as f64) / (sqrt_price as f64) * 100.0;
        assert_relative_eq!(diff_rate, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn test_bonk_usdc() {
        let sqrt_price = 265989152599097743u128; // 0.00002 USDC/BONK
        let decimals_a = 5u8; // BONK
        let decimals_b = 6u8; // USDC
        let price = sqrt_price_to_price(sqrt_price, decimals_a, decimals_b);
        assert_eq!(price, 2.0791623715496336e-5);
        let sqrt_price_back = price_to_sqrt_price(price, decimals_a, decimals_b);
        let diff = (sqrt_price_back as i128) - (sqrt_price as i128);
        let diff_rate = (diff as f64) / (sqrt_price as f64) * 100.0;
        assert_relative_eq!(diff_rate, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn test_get_sqrt_price_slippage_bounds() {
        let price = 1_000_000.0_f64;
        let sqrt_price: u128 = price_to_sqrt_price(price, 6, 6).into();
        assert_eq!(sqrt_price, 18446744073709551616000);

        for slippage_bps in [0u16, 1, 10, 50, 100, 200, 500, 1000, 5000] {
            let bounds = get_sqrt_price_slippage_bounds(sqrt_price, slippage_bps);

            let actual_min = sqrt_price_to_price(bounds.min_sqrt_price, 6, 6);
            let actual_max = sqrt_price_to_price(bounds.max_sqrt_price, 6, 6);

            let expected_min = price * (10_000.0 - slippage_bps as f64) / 10_000.0;
            let expected_max = price * (10_000.0 + slippage_bps as f64) / 10_000.0;

            assert_relative_eq!(actual_min, expected_min, max_relative = 0.0001);
            assert_relative_eq!(actual_max, expected_max, max_relative = 0.0001);
        }
    }
}
