#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use libm::{floor, pow, sqrt};

use super::{invert_tick_index, sqrt_price_to_tick_index, tick_index_to_sqrt_price};
use crate::{CoreError, MAX_SQRT_PRICE, MIN_SQRT_PRICE, SQRT_PRICE_OUT_OF_BOUNDS, U128};

const Q64_RESOLUTION: f64 = 18446744073709551616.0;

/// Check if a sqrt_price is within valid bounds and return an error if not.
///
/// # Parameters
/// - `sqrt_price` - A u128 representing the sqrt price
///
/// # Returns
/// - `Ok(())` if the sqrt_price is in bounds
/// - `Err(SQRT_PRICE_OUT_OF_BOUNDS)` if the sqrt_price is out of bounds
#[inline]
pub(crate) fn check_sqrt_price_bounds(sqrt_price: u128) -> Result<(), CoreError> {
    if sqrt_price >= MIN_SQRT_PRICE && sqrt_price <= MAX_SQRT_PRICE {
        Ok(())
    } else {
        Err(SQRT_PRICE_OUT_OF_BOUNDS)
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
    tick_index_to_price(inverted_tick_index, decimals_a, decimals_b).unwrap_or(0.0)
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
/// * `Result<f64, CoreError>` - The decimal price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn tick_index_to_price(tick_index: i32, decimals_a: u8, decimals_b: u8) -> Result<f64, CoreError> {
    let sqrt_price = tick_index_to_sqrt_price(tick_index)?;
    Ok(sqrt_price_to_price(sqrt_price, decimals_a, decimals_b))
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
    sqrt_price_to_tick_index(sqrt_price).unwrap_or(0) // Convert user-provided price, may be invalid
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
        assert_relative_eq!(tick_index_to_price(-92111, 8, 6).unwrap(), 0.009998, epsilon = 1e-5);
        assert_relative_eq!(tick_index_to_price(0, 6, 6).unwrap(), 1.0);
        assert_relative_eq!(tick_index_to_price(92108, 6, 8).unwrap(), 99.999912, epsilon = 1e-5);
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
}
