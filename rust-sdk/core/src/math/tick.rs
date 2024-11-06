use ethnum::U256;

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::{
    ErrorCode, TickRange, FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD, MAX_TICK_INDEX, MIN_TICK_INDEX, TICK_ARRAY_SIZE, TICK_INDEX_NOT_IN_ARRAY, U128
};

const LOG_B_2_X32: i128 = 59543866431248i128;
const BIT_PRECISION: u32 = 14;
const LOG_B_P_ERR_MARGIN_LOWER_X64: i128 = 184467440737095516i128; // 0.01
const LOG_B_P_ERR_MARGIN_UPPER_X64: i128 = 15793534762490258745i128; // 2^-precision / log_2_b + 0.01

/// Get the first tick index in the tick array that contains the specified tick index.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - A i32 integer representing the first tick index in the tick array
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_tick_array_start_tick_index(tick_index: i32, tick_spacing: u16) -> i32 {
    let tick_spacing_i32 = tick_spacing as i32;
    let tick_array_size_i32 = TICK_ARRAY_SIZE as i32;
    let real_index = tick_index
        .div_euclid(tick_spacing_i32)
        .div_euclid(tick_array_size_i32);
    real_index * tick_spacing_i32 * tick_array_size_i32
}

/// Derive the sqrt-price from a tick index. The precision of this method is only guarranted
/// if tick is within the bounds of {max, min} tick-index.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
///
/// # Returns
/// - `Ok`: A u128 Q32.64 representing the sqrt_price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn tick_index_to_sqrt_price(tick_index: i32) -> U128 {
    if tick_index >= 0 {
        get_sqrt_price_positive_tick(tick_index).into()
    } else {
        get_sqrt_price_negative_tick(tick_index).into()
    }
}

/// Derive the tick index from a sqrt price. The precision of this method is only guarranted
/// if tick is within the bounds of {max, min} tick-index.
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price
///
/// # Returns
/// - `Ok`: A i32 integer representing the tick integer
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn sqrt_price_to_tick_index(sqrt_price: U128) -> i32 {
    let sqrt_price_x64: u128 = sqrt_price.into();
    // Determine log_b(sqrt_ratio). First by calculating integer portion (msb)
    let msb: u32 = 128 - sqrt_price_x64.leading_zeros() - 1;
    let log2p_integer_x32 = (msb as i128 - 64) << 32;

    // get fractional value (r/2^msb), msb always > 128
    // We begin the iteration from bit 63 (0.5 in Q64.64)
    let mut bit: i128 = 0x8000_0000_0000_0000i128;
    let mut precision = 0;
    let mut log2p_fraction_x64 = 0;

    // Log2 iterative approximation for the fractional part
    // Go through each 2^(j) bit where j < 64 in a Q64.64 number
    // Append current bit value to fraction result if r^2 Q2.126 is more than 2
    let mut r = if msb >= 64 {
        sqrt_price_x64 >> (msb - 63)
    } else {
        sqrt_price_x64 << (63 - msb)
    };

    while bit > 0 && precision < BIT_PRECISION {
        r *= r;
        let is_r_more_than_two = r >> 127_u32;
        r >>= 63 + is_r_more_than_two;
        log2p_fraction_x64 += bit * is_r_more_than_two as i128;
        bit >>= 1;
        precision += 1;
    }

    let log2p_fraction_x32 = log2p_fraction_x64 >> 32;
    let log2p_x32 = log2p_integer_x32 + log2p_fraction_x32;

    // Transform from base 2 to base b
    let logbp_x64 = log2p_x32 * LOG_B_2_X32;

    // Derive tick_low & high estimate. Adjust with the possibility of under-estimating by 2^precision_bits/log_2(b) + 0.01 error margin.
    let tick_low: i32 = ((logbp_x64 - LOG_B_P_ERR_MARGIN_LOWER_X64) >> 64) as i32;
    let tick_high: i32 = ((logbp_x64 + LOG_B_P_ERR_MARGIN_UPPER_X64) >> 64) as i32;

    if tick_low == tick_high {
        tick_low
    } else {
        // If our estimation for tick_high returns a lower sqrt_price than the input
        // then the actual tick_high has to be higher than than tick_high.
        // Otherwise, the actual value is between tick_low & tick_high, so a floor value
        // (tick_low) is returned
        let actual_tick_high_sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick_high).into();
        if actual_tick_high_sqrt_price_x64 <= sqrt_price_x64 {
            tick_high
        } else {
            tick_low
        }
    }
}

/// Get the initializable tick index.
/// If the tick index is already initializable, it is returned as is.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
/// - `round_up` - A boolean value indicating if the supplied tick index should be rounded up. None will round to the nearest.
///
/// # Returns
/// - A i32 integer representing the previous initializable tick index
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_initializable_tick_index(
    tick_index: i32,
    tick_spacing: u16,
    round_up: Option<bool>,
) -> i32 {
    let tick_spacing_i32 = tick_spacing as i32;
    let remainder = tick_index.rem_euclid(tick_spacing_i32);
    let result = tick_index.div_euclid(tick_spacing_i32) * tick_spacing_i32;

    let should_round_up = if let Some(round_up) = round_up {
        round_up && remainder > 0
    } else {
        remainder >= tick_spacing_i32 / 2
    };

    if should_round_up {
        result + tick_spacing_i32
    } else {
        result
    }
}

/// Get the previous initializable tick index.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - A i32 integer representing the previous initializable tick index
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_prev_initializable_tick_index(tick_index: i32, tick_spacing: u16) -> i32 {
    let tick_spacing_i32 = tick_spacing as i32;
    let remainder = tick_index.rem_euclid(tick_spacing_i32);
    if remainder == 0 {
        tick_index - tick_spacing_i32
    } else {
        tick_index - remainder
    }
}

/// Get the next initializable tick index.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - A i32 integer representing the next initializable tick index
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_next_initializable_tick_index(tick_index: i32, tick_spacing: u16) -> i32 {
    let tick_spacing_i32 = tick_spacing as i32;
    let remainder = tick_index.rem_euclid(tick_spacing_i32);
    tick_index - remainder + tick_spacing_i32
}

/// Check if a tick is in-bounds.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
///
/// # Returns
/// - A boolean value indicating if the tick is in-bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
#[allow(clippy::manual_range_contains)]
pub fn is_tick_index_in_bounds(tick_index: i32) -> bool {
    tick_index <= MAX_TICK_INDEX && tick_index >= MIN_TICK_INDEX
}

/// Check if a tick is initializable.
/// A tick is initializable if it is divisible by the tick spacing.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - A boolean value indicating if the tick is initializable
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn is_tick_initializable(tick_index: i32, tick_spacing: u16) -> bool {
    let tick_spacing_i32 = tick_spacing as i32;
    tick_index % tick_spacing_i32 == 0
}

/// Get the tick index for the inverse of the price that this tick represents.
/// Eg: Consider tick i where Pb/Pa = 1.0001 ^ i
/// inverse of this, i.e. Pa/Pb = 1 / (1.0001 ^ i) = 1.0001^-i
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
///
/// # Returns
/// - A i32 integer representing the tick index for the inverse of the price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn invert_tick_index(tick_index: i32) -> i32 {
    -tick_index
}

/// Get the sqrt price for the inverse of the price that this tick represents.
/// Because converting to a tick index and then back to a sqrt price is lossy,
/// this function is clamped to the nearest tick index.
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price
///
/// # Returns
/// - A u128 integer representing the sqrt price for the inverse of the price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn invert_sqrt_price(sqrt_price: U128) -> U128 {
    let tick_index = sqrt_price_to_tick_index(sqrt_price);
    let inverted_tick_index = invert_tick_index(tick_index);
    tick_index_to_sqrt_price(inverted_tick_index)
}

/// Get the minimum and maximum tick index that can be initialized.
///
/// # Parameters
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - A TickRange struct containing the lower and upper tick index
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_full_range_tick_indexes(tick_spacing: u16) -> TickRange {
    let tick_spacing_i32 = tick_spacing as i32;
    let min_tick_index = (MIN_TICK_INDEX / tick_spacing_i32) * tick_spacing_i32;
    let max_tick_index = (MAX_TICK_INDEX / tick_spacing_i32) * tick_spacing_i32;
    TickRange {
        tick_lower_index: min_tick_index,
        tick_upper_index: max_tick_index,
    }
}

/// Order tick indexes in ascending order.
/// If the lower tick index is greater than the upper tick index, the indexes are swapped.
/// This is useful for ensuring that the lower tick index is always less than the upper tick index.
///
/// # Parameters
/// - `tick_index_1` - A i32 integer representing the first tick index
/// - `tick_index_2` - A i32 integer representing the second tick index
///
/// # Returns
/// - A TickRange struct containing the lower and upper tick index
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn order_tick_indexes(tick_index_1: i32, tick_index_2: i32) -> TickRange {
    if tick_index_1 < tick_index_2 {
        TickRange {
            tick_lower_index: tick_index_1,
            tick_upper_index: tick_index_2,
        }
    } else {
        TickRange {
            tick_lower_index: tick_index_2,
            tick_upper_index: tick_index_1,
        }
    }
}

/// Check if a whirlpool is a full-range only pool.
///
/// # Parameters
/// - `tick_spacing` - A u16 integer representing the tick spacing
///
/// # Returns
/// - A boolean value indicating if the whirlpool is a full-range only pool
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn is_full_range_only(tick_spacing: u16) -> bool {
    tick_spacing >= FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD
}

/// Get the index of a tick in a tick array.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick index
/// - `tick_array_start_index` - A i32 integer representing the start tick index of the tick array
/// - `tick_spacing` - A u16 integer representing the tick spacing
///
/// # Returns
/// - A u32 integer representing the tick index in the tick array
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_tick_index_in_array(
    tick_index: i32,
    tick_array_start_index: i32,
    tick_spacing: u16,
) -> Result<u32, ErrorCode> {
    let tick_spacing_i32 = tick_spacing as i32;
    if tick_index < tick_array_start_index {
        return Err(TICK_INDEX_NOT_IN_ARRAY);
    }
    if tick_index >= tick_array_start_index + (TICK_ARRAY_SIZE as i32) * tick_spacing_i32 {
        return Err(TICK_INDEX_NOT_IN_ARRAY);
    }
    let result = (tick_index - tick_array_start_index)
        .div_euclid(tick_spacing_i32)
        .unsigned_abs();
    Ok(result)
}

// Private functions

fn mul_shift_96(n0: u128, n1: u128) -> u128 {
    let mul: U256 = (<U256>::from(n0) * <U256>::from(n1)) >> 96;
    mul.as_u128()
}

fn get_sqrt_price_positive_tick(tick: i32) -> u128 {
    let mut ratio: u128 = if tick & 1 != 0 {
        79232123823359799118286999567
    } else {
        79228162514264337593543950336
    };

    if tick & 2 != 0 {
        ratio = mul_shift_96(ratio, 79236085330515764027303304731);
    }
    if tick & 4 != 0 {
        ratio = mul_shift_96(ratio, 79244008939048815603706035061);
    }
    if tick & 8 != 0 {
        ratio = mul_shift_96(ratio, 79259858533276714757314932305);
    }
    if tick & 16 != 0 {
        ratio = mul_shift_96(ratio, 79291567232598584799939703904);
    }
    if tick & 32 != 0 {
        ratio = mul_shift_96(ratio, 79355022692464371645785046466);
    }
    if tick & 64 != 0 {
        ratio = mul_shift_96(ratio, 79482085999252804386437311141);
    }
    if tick & 128 != 0 {
        ratio = mul_shift_96(ratio, 79736823300114093921829183326);
    }
    if tick & 256 != 0 {
        ratio = mul_shift_96(ratio, 80248749790819932309965073892);
    }
    if tick & 512 != 0 {
        ratio = mul_shift_96(ratio, 81282483887344747381513967011);
    }
    if tick & 1024 != 0 {
        ratio = mul_shift_96(ratio, 83390072131320151908154831281);
    }
    if tick & 2048 != 0 {
        ratio = mul_shift_96(ratio, 87770609709833776024991924138);
    }
    if tick & 4096 != 0 {
        ratio = mul_shift_96(ratio, 97234110755111693312479820773);
    }
    if tick & 8192 != 0 {
        ratio = mul_shift_96(ratio, 119332217159966728226237229890);
    }
    if tick & 16384 != 0 {
        ratio = mul_shift_96(ratio, 179736315981702064433883588727);
    }
    if tick & 32768 != 0 {
        ratio = mul_shift_96(ratio, 407748233172238350107850275304);
    }
    if tick & 65536 != 0 {
        ratio = mul_shift_96(ratio, 2098478828474011932436660412517);
    }
    if tick & 131072 != 0 {
        ratio = mul_shift_96(ratio, 55581415166113811149459800483533);
    }
    if tick & 262144 != 0 {
        ratio = mul_shift_96(ratio, 38992368544603139932233054999993551);
    }

    ratio >> 32
}

fn get_sqrt_price_negative_tick(tick: i32) -> u128 {
    let abs_tick = tick.abs();

    let mut ratio: u128 = if abs_tick & 1 != 0 {
        18445821805675392311
    } else {
        18446744073709551616
    };

    if abs_tick & 2 != 0 {
        ratio = (ratio * 18444899583751176498) >> 64
    }
    if abs_tick & 4 != 0 {
        ratio = (ratio * 18443055278223354162) >> 64
    }
    if abs_tick & 8 != 0 {
        ratio = (ratio * 18439367220385604838) >> 64
    }
    if abs_tick & 16 != 0 {
        ratio = (ratio * 18431993317065449817) >> 64
    }
    if abs_tick & 32 != 0 {
        ratio = (ratio * 18417254355718160513) >> 64
    }
    if abs_tick & 64 != 0 {
        ratio = (ratio * 18387811781193591352) >> 64
    }
    if abs_tick & 128 != 0 {
        ratio = (ratio * 18329067761203520168) >> 64
    }
    if abs_tick & 256 != 0 {
        ratio = (ratio * 18212142134806087854) >> 64
    }
    if abs_tick & 512 != 0 {
        ratio = (ratio * 17980523815641551639) >> 64
    }
    if abs_tick & 1024 != 0 {
        ratio = (ratio * 17526086738831147013) >> 64
    }
    if abs_tick & 2048 != 0 {
        ratio = (ratio * 16651378430235024244) >> 64
    }
    if abs_tick & 4096 != 0 {
        ratio = (ratio * 15030750278693429944) >> 64
    }
    if abs_tick & 8192 != 0 {
        ratio = (ratio * 12247334978882834399) >> 64
    }
    if abs_tick & 16384 != 0 {
        ratio = (ratio * 8131365268884726200) >> 64
    }
    if abs_tick & 32768 != 0 {
        ratio = (ratio * 3584323654723342297) >> 64
    }
    if abs_tick & 65536 != 0 {
        ratio = (ratio * 696457651847595233) >> 64
    }
    if abs_tick & 131072 != 0 {
        ratio = (ratio * 26294789957452057) >> 64
    }
    if abs_tick & 262144 != 0 {
        ratio = (ratio * 37481735321082) >> 64
    }

    ratio
}

// Tests

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;
    use crate::{MAX_SQRT_PRICE, MIN_SQRT_PRICE};

    #[test]
    fn test_get_tick_array_start_tick_index() {
        assert_eq!(get_tick_array_start_tick_index(1000, 10), 880);
        assert_eq!(get_tick_array_start_tick_index(100, 10), 0);
        assert_eq!(get_tick_array_start_tick_index(0, 10), 0);
        assert_eq!(get_tick_array_start_tick_index(-100, 10), -880);
        assert_eq!(get_tick_array_start_tick_index(-1000, 10), -1760);
    }

    #[test]
    fn test_tick_index_to_sqrt_price() {
        assert_eq!(tick_index_to_sqrt_price(MAX_TICK_INDEX), MAX_SQRT_PRICE);
        assert_eq!(tick_index_to_sqrt_price(100), 18539204128674405812);
        assert_eq!(tick_index_to_sqrt_price(1), 18447666387855959850);
        assert_eq!(tick_index_to_sqrt_price(0), 18446744073709551616);
        assert_eq!(tick_index_to_sqrt_price(-1), 18445821805675392311);
        assert_eq!(tick_index_to_sqrt_price(-100), 18354745142194483561);
        assert_eq!(tick_index_to_sqrt_price(MIN_TICK_INDEX), MIN_SQRT_PRICE);
    }

    #[test]
    fn test_sqrt_price_to_tick_index() {
        assert_eq!(sqrt_price_to_tick_index(MAX_SQRT_PRICE), MAX_TICK_INDEX);
        assert_eq!(sqrt_price_to_tick_index(18539204128674405812), 100);
        assert_eq!(sqrt_price_to_tick_index(18447666387855959850), 1);
        assert_eq!(sqrt_price_to_tick_index(18446744073709551616), 0);
        assert_eq!(sqrt_price_to_tick_index(18445821805675392311), -1);
        assert_eq!(sqrt_price_to_tick_index(18354745142194483561), -100);
        assert_eq!(sqrt_price_to_tick_index(MIN_SQRT_PRICE), MIN_TICK_INDEX);
    }

    #[test]
    fn test_get_initializable_tick_index() {
        assert_eq!(get_initializable_tick_index(-100, 10, Some(true)), -100);
        assert_eq!(get_initializable_tick_index(-100, 10, Some(false)), -100);
        assert_eq!(get_initializable_tick_index(-100, 10, None), -100);

        assert_eq!(get_initializable_tick_index(-101, 10, Some(true)), -100);
        assert_eq!(get_initializable_tick_index(-101, 10, Some(false)), -110);
        assert_eq!(get_initializable_tick_index(-101, 10, None), -100);

        assert_eq!(get_initializable_tick_index(-105, 10, Some(true)), -100);
        assert_eq!(get_initializable_tick_index(-105, 10, Some(false)), -110);
        assert_eq!(get_initializable_tick_index(-105, 10, None), -100);

        assert_eq!(get_initializable_tick_index(-109, 10, Some(true)), -100);
        assert_eq!(get_initializable_tick_index(-109, 10, Some(false)), -110);
        assert_eq!(get_initializable_tick_index(-109, 10, None), -110);

        assert_eq!(get_initializable_tick_index(-100, 10, Some(true)), -100);
        assert_eq!(get_initializable_tick_index(-100, 10, Some(false)), -100);
        assert_eq!(get_initializable_tick_index(-100, 10, None), -100);

        assert_eq!(get_initializable_tick_index(101, 10, Some(true)), 110);
        assert_eq!(get_initializable_tick_index(101, 10, Some(false)), 100);
        assert_eq!(get_initializable_tick_index(101, 10, None), 100);

        assert_eq!(get_initializable_tick_index(105, 10, Some(true)), 110);
        assert_eq!(get_initializable_tick_index(105, 10, Some(false)), 100);
        assert_eq!(get_initializable_tick_index(105, 10, None), 110);

        assert_eq!(get_initializable_tick_index(109, 10, Some(true)), 110);
        assert_eq!(get_initializable_tick_index(109, 10, Some(false)), 100);
        assert_eq!(get_initializable_tick_index(109, 10, None), 110);
    }

    #[test]
    fn test_get_prev_initializable_tick_index() {
        assert_eq!(get_prev_initializable_tick_index(10, 10), 0);
        assert_eq!(get_prev_initializable_tick_index(5, 10), 0);
        assert_eq!(get_prev_initializable_tick_index(0, 10), -10);
        assert_eq!(get_prev_initializable_tick_index(-5, 10), -10);
        assert_eq!(get_prev_initializable_tick_index(-10, 10), -20);
    }

    #[test]
    fn test_get_next_initializable_tick_index() {
        assert_eq!(get_next_initializable_tick_index(10, 10), 20);
        assert_eq!(get_next_initializable_tick_index(5, 10), 10);
        assert_eq!(get_next_initializable_tick_index(0, 10), 10);
        assert_eq!(get_next_initializable_tick_index(-5, 10), 0);
        assert_eq!(get_next_initializable_tick_index(-10, 10), 0);
    }

    #[test]
    fn test_is_tick_index_in_bounds() {
        assert!(is_tick_index_in_bounds(MAX_TICK_INDEX));
        assert!(is_tick_index_in_bounds(MIN_TICK_INDEX));
        assert!(!is_tick_index_in_bounds(MAX_TICK_INDEX + 1));
        assert!(!is_tick_index_in_bounds(MIN_TICK_INDEX - 1));
    }

    #[test]
    fn test_is_tick_initializable() {
        assert!(is_tick_initializable(100, 10));
        assert!(!is_tick_initializable(105, 10));
    }

    #[test]
    fn test_invert_tick_index() {
        assert_eq!(invert_tick_index(100), -100);
        assert_eq!(invert_tick_index(-100), 100);
    }

    #[test]
    fn test_get_full_range_tick_indexes() {
        let range = get_full_range_tick_indexes(10);
        assert_eq!(range.tick_lower_index, (MIN_TICK_INDEX / 10) * 10);
        assert_eq!(range.tick_upper_index, (MAX_TICK_INDEX / 10) * 10);
    }

    #[test]
    fn test_order_tick_indexes() {
        let range_1 = order_tick_indexes(100, 200);
        assert_eq!(range_1.tick_lower_index, 100);
        assert_eq!(range_1.tick_upper_index, 200);

        let range_2 = order_tick_indexes(200, 100);
        assert_eq!(range_2.tick_lower_index, 100);
        assert_eq!(range_2.tick_upper_index, 200);

        let range_3 = order_tick_indexes(100, 100);
        assert_eq!(range_3.tick_lower_index, 100);
        assert_eq!(range_3.tick_upper_index, 100);
    }

    #[test]
    fn test_is_full_range_only() {
        assert!(is_full_range_only(FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD));
        assert!(!is_full_range_only(
            FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD - 1
        ));
    }

    #[test]
    fn test_get_tick_index_in_array() {
        assert_eq!(get_tick_index_in_array(880, 0, 10), Err(TICK_INDEX_NOT_IN_ARRAY));
        assert_eq!(get_tick_index_in_array(100, 0, 10), Ok(10));
        assert_eq!(get_tick_index_in_array(50, 0, 10), Ok(5));
        assert_eq!(get_tick_index_in_array(0, 0, 10), Ok(0));
        assert_eq!(get_tick_index_in_array(-1, 0, 10), Err(TICK_INDEX_NOT_IN_ARRAY));
        assert_eq!(get_tick_index_in_array(-830, -880, 10), Ok(5));
        assert_eq!(get_tick_index_in_array(-780, -880, 10), Ok(10));
        assert_eq!(get_tick_index_in_array(-881, -880, 10), Err(TICK_INDEX_NOT_IN_ARRAY));
    }
}
