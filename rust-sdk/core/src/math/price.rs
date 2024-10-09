#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use libm::{floor, pow, sqrt};

use crate::U128;

use super::{invert_tick_index, sqrt_price_to_tick_index, tick_index_to_sqrt_price};

const Q64_RESOLUTION: f64 = 18446744073709551616.0;

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
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = priceToSqrtPrice, skip_jsdoc))]
pub fn price_to_sqrt_price(price: f64, decimals_a: u8, decimals_b: u8) -> U128 {
    let power = pow(10f64, decimals_a as f64 - decimals_b as f64);

    (floor(sqrt(price * power) * Q64_RESOLUTION) as u128).into()
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
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = sqrtPriceToPrice, skip_jsdoc))]
pub fn sqrt_price_to_price(sqrt_price: U128, decimals_a: u8, decimals_b: u8) -> f64 {
    let power = pow(10f64, decimals_a as f64 - decimals_b as f64);
    let sqrt_price: u128 = sqrt_price.into();
    let sqrt_price_u128 = sqrt_price as f64;
    pow(sqrt_price_u128 / Q64_RESOLUTION, 2.0) / power
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
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = invertPrice, skip_jsdoc))]
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
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = tickIndexToPrice, skip_jsdoc))]
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
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = priceToTickIndex, skip_jsdoc))]
pub fn price_to_tick_index(price: f64, decimals_a: u8, decimals_b: u8) -> i32 {
    let sqrt_price = price_to_sqrt_price(price, decimals_a, decimals_b);
    sqrt_price_to_tick_index(sqrt_price)
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;
    use approx::relative_eq;

    #[test]
    fn test_price_to_sqrt_price() {
        assert_eq!(price_to_sqrt_price(100.0, 8, 6), 1844674407370955161600);
        assert_eq!(price_to_sqrt_price(100.0, 6, 6), 184467440737095516160);
        assert_eq!(price_to_sqrt_price(100.0, 6, 8), 18446744073709551616);
    }

    #[test]
    fn test_sqrt_price_to_price() {
        assert_eq!(sqrt_price_to_price(1844674407370955161600, 8, 6), 100.0);
        assert_eq!(sqrt_price_to_price(184467440737095516160, 6, 6), 100.0);
        assert_eq!(sqrt_price_to_price(18446744073709551616, 6, 8), 100.0);
    }

    #[test]
    fn test_invert_price() {
        relative_eq!(invert_price(100.0, 8, 6), 0.000001);
        relative_eq!(invert_price(100.0, 6, 6), 0.0);
        relative_eq!(invert_price(100.0, 6, 8), -1000.0);
    }

    #[test]
    fn test_tick_index_to_price() {
        relative_eq!(tick_index_to_price(-1, 8, 6), 0.00999999);
        relative_eq!(tick_index_to_price(0, 6, 6), 1.0);
        relative_eq!(tick_index_to_price(1, 6, 8), 100.011);
    }

    #[test]
    fn test_price_to_tick_index() {
        assert_eq!(price_to_tick_index(0.00999999, 8, 6), -1);
        assert_eq!(price_to_tick_index(1.0, 6, 6), 0);
        assert_eq!(price_to_tick_index(100.011, 6, 8), 1);
    }
}
