use ethnum::U256;

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::{
    CoreError, TickRange, FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD, MAX_TICK_INDEX, MIN_TICK_INDEX,
    TICK_ARRAY_SIZE, TICK_INDEX_NOT_IN_ARRAY, TICK_INDEX_OUT_OF_BOUNDS, U128,
};

use super::price::check_sqrt_price_bounds;

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
/// - `Ok(U128)`: A u128 Q32.64 representing the sqrt_price
/// - `Err(CoreError)`: If tick_index is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn tick_index_to_sqrt_price(tick_index: i32) -> Result<U128, CoreError> {
    check_tick_index_bounds(tick_index)?;
    Ok(if tick_index >= 0 {
        get_sqrt_price_positive_tick(tick_index).into()
    } else {
        get_sqrt_price_negative_tick(tick_index).into()
    })
}

/// Derive the tick index from a sqrt price. The precision of this method is only guarranted
/// if tick is within the bounds of {max, min} tick-index.
/// This function will make panic for zero sqrt price.
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price
///
/// # Returns
/// - `Ok(i32)`: The tick index
/// - `Err(CoreError)`: If sqrt_price is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn sqrt_price_to_tick_index(sqrt_price: U128) -> Result<i32, CoreError> {
    let sqrt_price_x64: u128 = sqrt_price.into();
    check_sqrt_price_bounds(sqrt_price_x64)?;

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
        Ok(tick_low)
    } else {
        // If our estimation for tick_high returns a lower sqrt_price than the input
        // then the actual tick_high has to be higher than tick_high.
        // Otherwise, the actual value is between tick_low & tick_high, so a floor value
        // (tick_low) is returned
        let actual_tick_high_sqrt_price_x64: u128 =
            tick_index_to_sqrt_price(tick_high).unwrap().into(); // safe unwrap: sqrt_price validation guarantees tick_high is in bounds
        if actual_tick_high_sqrt_price_x64 <= sqrt_price_x64 {
            Ok(tick_high)
        } else {
            Ok(tick_low)
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
/// - `Ok(i32)`: The initializable tick index (rounded per round_up or nearest)
/// - `Err(CoreError)`: If tick_index is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_initializable_tick_index(
    tick_index: i32,
    tick_spacing: u16,
    round_up: Option<bool>,
) -> Result<i32, CoreError> {
    check_tick_index_bounds(tick_index)?;
    let tick_spacing_i32 = tick_spacing as i32;
    let remainder = tick_index.rem_euclid(tick_spacing_i32);
    let result = tick_index.div_euclid(tick_spacing_i32) * tick_spacing_i32;

    let should_round_up = if let Some(round_up) = round_up {
        round_up && remainder > 0
    } else {
        remainder >= tick_spacing_i32 / 2 && remainder > 0
    };

    Ok(if should_round_up {
        result + tick_spacing_i32
    } else {
        result
    })
}

/// Get the previous initializable tick index.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - `Ok(i32)`: The previous initializable tick index
/// - `Err(CoreError)`: If tick_index is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_prev_initializable_tick_index(
    tick_index: i32,
    tick_spacing: u16,
) -> Result<i32, CoreError> {
    check_tick_index_bounds(tick_index)?;
    let tick_spacing_i32 = tick_spacing as i32;
    let remainder = tick_index.rem_euclid(tick_spacing_i32);
    Ok(if remainder == 0 {
        tick_index - tick_spacing_i32
    } else {
        tick_index - remainder
    })
}

/// Get the next initializable tick index.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - `Ok(i32)`: The next initializable tick index
/// - `Err(CoreError)`: If tick_index is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_next_initializable_tick_index(
    tick_index: i32,
    tick_spacing: u16,
) -> Result<i32, CoreError> {
    check_tick_index_bounds(tick_index)?;
    let tick_spacing_i32 = tick_spacing as i32;
    let remainder = tick_index.rem_euclid(tick_spacing_i32);
    Ok(tick_index - remainder + tick_spacing_i32)
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

/// Check if a tick index is within valid bounds and return an error if not.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
///
/// # Returns
/// - `Ok(())` if the tick index is in bounds
/// - `Err(TICK_INDEX_OUT_OF_BOUNDS)` if the tick index is out of bounds
#[inline]
fn check_tick_index_bounds(tick_index: i32) -> Result<(), CoreError> {
    if is_tick_index_in_bounds(tick_index) {
        Ok(())
    } else {
        Err(TICK_INDEX_OUT_OF_BOUNDS)
    }
}

/// Check if a tick is initializable.
/// A tick is initializable if it is divisible by the tick spacing.
///
/// # Parameters
/// - `tick_index` - A i32 integer representing the tick integer
/// - `tick_spacing` - A i32 integer representing the tick spacing
///
/// # Returns
/// - `Ok(bool)`: Whether the tick is initializable
/// - `Err(CoreError)`: If tick_index is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn is_tick_initializable(tick_index: i32, tick_spacing: u16) -> Result<bool, CoreError> {
    check_tick_index_bounds(tick_index)?;
    let tick_spacing_i32 = tick_spacing as i32;
    Ok(tick_index % tick_spacing_i32 == 0)
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
/// - `Ok(U128)`: The sqrt price for the inverse of the price
/// - `Err(CoreError)`: If sqrt_price or calculated tick is out of bounds
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn invert_sqrt_price(sqrt_price: U128) -> Result<U128, CoreError> {
    let tick_index = sqrt_price_to_tick_index(sqrt_price)?;
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
) -> Result<u32, CoreError> {
    if tick_index < tick_array_start_index {
        return Err(TICK_INDEX_NOT_IN_ARRAY);
    }
    if tick_index >= tick_array_start_index + (TICK_ARRAY_SIZE as i32) * (tick_spacing as i32) {
        return Err(TICK_INDEX_NOT_IN_ARRAY);
    }
    let result = (tick_index - tick_array_start_index).unsigned_abs() / (tick_spacing as u32);
    Ok(result)
}

// Private functions
fn mul_shift_96(n0: u128, n1: u128) -> u128 {
    let mul: U256 = (<U256>::from(n0) * <U256>::from(n1)) >> 96;
    mul.try_into().unwrap() // safe unwrap: tick_index is bounded in tick_index_to_sqrt_price
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

#[cfg(all(test, not(feature = "wasm")))]
mod test_get_tick_array_start_tick_index {
    use super::*;
    const TS_8: u16 = 8;
    const TS_128: u16 = 128;

    #[test]
    fn test_start_tick_ts8_0() {
        assert_eq!(get_tick_array_start_tick_index(0, TS_8), 0);
    }

    #[test]
    fn test_start_tick_ts8_740() {
        assert_eq!(get_tick_array_start_tick_index(740, TS_8), 704);
    }

    #[test]
    fn test_start_tick_ts128_337920() {
        assert_eq!(get_tick_array_start_tick_index(338433, TS_128), 337920);
    }

    #[test]
    fn test_start_tick_ts8_negative_704() {
        assert_eq!(get_tick_array_start_tick_index(-624, TS_8), -704);
    }

    #[test]
    fn test_start_tick_ts128_negative_337920() {
        assert_eq!(get_tick_array_start_tick_index(-337409, TS_128), -337920);
    }

    #[test]
    fn test_start_tick_ts8_not_2353573() {
        assert_ne!(get_tick_array_start_tick_index(2354285, TS_8), 2353573);
    }

    #[test]
    fn test_start_tick_ts128_not_negative_2353573() {
        assert_ne!(get_tick_array_start_tick_index(-2342181, TS_128), -2353573);
    }

    #[test]
    fn test_min_tick_array_start_tick_is_valid_ts8() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE as i32 / TS_8 as i32) - 1;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE as i32 * TS_8 as i32;
        assert_eq!(
            get_tick_array_start_tick_index(MIN_TICK_INDEX, TS_8),
            expected_start_index_for_last_array
        );
    }

    #[test]
    fn test_min_tick_array_start_tick_is_valid_ts128() {
        let expected_array_index: i32 =
            (MIN_TICK_INDEX / TICK_ARRAY_SIZE as i32 / TS_128 as i32) - 1;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE as i32 * TS_128 as i32;
        assert_eq!(
            get_tick_array_start_tick_index(MIN_TICK_INDEX, TS_128),
            expected_start_index_for_last_array
        );
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_tick_index_to_sqrt_price {
    use super::*;
    use crate::{MAX_SQRT_PRICE, MAX_TICK_INDEX, MIN_SQRT_PRICE, MIN_TICK_INDEX};
    use rstest::rstest;

    #[test]
    fn test_tick_below_min_errors() {
        let result = tick_index_to_sqrt_price(MIN_TICK_INDEX - 1);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_tick_above_max_errors() {
        let result = tick_index_to_sqrt_price(MAX_TICK_INDEX + 1);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_tick_at_max() {
        let max_tick = MAX_TICK_INDEX;
        let r = tick_index_to_sqrt_price(max_tick).unwrap();
        assert_eq!(r, MAX_SQRT_PRICE);
    }

    #[test]
    fn test_tick_at_min() {
        let min_tick = MIN_TICK_INDEX;
        let r = tick_index_to_sqrt_price(min_tick).unwrap();
        assert_eq!(r, MIN_SQRT_PRICE);
    }

    #[rstest]
    #[case(0, 18446744073709551616, 18446744073709551616, "0x0")]
    #[case(1, 18447666387855959850, 18445821805675392311, "0x1")]
    #[case(2, 18448588748116922571, 18444899583751176498, "0x2")]
    #[case(4, 18450433606991734263, 18443055278223354162, "0x4")]
    #[case(8, 18454123878217468680, 18439367220385604838, "0x8")]
    #[case(16, 18461506635090006701, 18431993317065449817, "0x10")]
    #[case(32, 18476281010653910144, 18417254355718160513, "0x20")]
    #[case(64, 18505865242158250041, 18387811781193591352, "0x40")]
    #[case(128, 18565175891880433522, 18329067761203520168, "0x80")]
    #[case(256, 18684368066214940582, 18212142134806087854, "0x100")]
    #[case(512, 18925053041275764671, 17980523815641551639, "0x200")]
    #[case(1024, 19415764168677886926, 17526086738831147013, "0x400")]
    #[case(2048, 20435687552633177494, 16651378430235024244, "0x800")]
    #[case(4096, 22639080592224303007, 15030750278693429944, "0x1000")]
    #[case(8192, 27784196929998399742, 12247334978882834399, "0x2000")]
    #[case(16384, 41848122137994986128, 8131365268884726200, "0x4000")]
    #[case(32768, 94936283578220370716, 3584323654723342297, "0x8000")]
    #[case(65536, 488590176327622479860, 696457651847595233, "0x10000")]
    #[case(131072, 12941056668319229769860, 26294789957452057, "0x20000")]
    #[case(262144, 9078618265828848800676189, 37481735321082, "0x40000")]
    fn test_exact_bit_values(
        #[case] tick: i32,
        #[case] expected_positive: u128,
        #[case] expected_negative: u128,
        #[case] description: &str,
    ) {
        let p_result = tick_index_to_sqrt_price(tick).unwrap();
        let n_result = tick_index_to_sqrt_price(-tick).unwrap();
        assert_eq!(
            p_result, expected_positive,
            "Failed for tick {} ({})",
            tick, description
        );
        assert_eq!(
            n_result, expected_negative,
            "Failed for -tick {} ({})",
            tick, description
        );
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_sqrt_price_to_tick_index {
    use super::*;
    use crate::{MAX_SQRT_PRICE, MAX_TICK_INDEX, MIN_SQRT_PRICE, MIN_TICK_INDEX};

    #[test]
    fn test_sqrt_price_to_tick_index_at_max() {
        let r = sqrt_price_to_tick_index(MAX_SQRT_PRICE).unwrap();
        assert_eq!(&r, &MAX_TICK_INDEX);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_min() {
        let r = sqrt_price_to_tick_index(MIN_SQRT_PRICE).unwrap();
        assert_eq!(&r, &MIN_TICK_INDEX);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_max_add_one() {
        let sqrt_price_x64_max_add_one = MAX_SQRT_PRICE + 1;
        let tick_from_max_add_one = sqrt_price_to_tick_index(sqrt_price_x64_max_add_one);
        let sqrt_price_x64_max = MAX_SQRT_PRICE;
        let tick_from_max = sqrt_price_to_tick_index(sqrt_price_x64_max).unwrap();
        // We don't care about accuracy over the limit. We just care about it's equality properties.
        assert!(tick_from_max_add_one.is_err() || tick_from_max_add_one.unwrap() >= tick_from_max);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_min_add_one() {
        let sqrt_price_x64 = MIN_SQRT_PRICE + 1;
        let r = sqrt_price_to_tick_index(sqrt_price_x64).unwrap();
        assert_eq!(&r, &(MIN_TICK_INDEX));
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_max_sub_one() {
        let sqrt_price_x64 = MAX_SQRT_PRICE - 1;
        let r = sqrt_price_to_tick_index(sqrt_price_x64).unwrap();
        assert_eq!(&r, &(MAX_TICK_INDEX - 1));
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_min_sub_one() {
        let sqrt_price_x64_min_sub_one = MIN_SQRT_PRICE - 1;
        let tick_from_min_sub_one = sqrt_price_to_tick_index(sqrt_price_x64_min_sub_one);
        let sqrt_price_x64_min = MIN_SQRT_PRICE + 1;
        let tick_from_min = sqrt_price_to_tick_index(sqrt_price_x64_min).unwrap();
        // We don't care about accuracy under the limit. We just care about it's equality properties.
        assert!(tick_from_min_sub_one.is_err() || tick_from_min_sub_one.unwrap() < tick_from_min);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_one() {
        let sqrt_price_x64: u128 = u64::MAX as u128 + 1;
        let r = sqrt_price_to_tick_index(sqrt_price_x64).unwrap();
        assert_eq!(r, 0);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_one_add_one() {
        let sqrt_price_x64: u128 = u64::MAX as u128 + 2;
        let r = sqrt_price_to_tick_index(sqrt_price_x64).unwrap();
        assert_eq!(r, 0);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_one_sub_one() {
        let sqrt_price_x64: u128 = u64::MAX.into();
        let r = sqrt_price_to_tick_index(sqrt_price_x64).unwrap();
        assert_eq!(r, -1);
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod fuzz_tests {
    use super::*;
    use crate::{MAX_SQRT_PRICE, MAX_TICK_INDEX, MIN_SQRT_PRICE, MIN_TICK_INDEX};
    use ethnum::U256;
    use proptest::prelude::*;

    fn within_price_approximation(lower: u128, upper: u128) -> bool {
        let precision = 96u32;
        // We increase the resolution of upper to find ratio_x96
        let x = U256::from(upper) << precision;
        let y = U256::from(lower);

        // (1.0001 ^ 0.5) << 96 (precision)
        let sqrt_10001_x96 = 79232123823359799118286999567u128;

        // This ratio should be as close to sqrt_10001_x96 as possible
        let ratio_x96 = (x / y).as_u128();

        // Find absolute error in ratio in x96
        let error = if sqrt_10001_x96 > ratio_x96 {
            sqrt_10001_x96 - ratio_x96
        } else {
            ratio_x96 - sqrt_10001_x96
        };

        // Calculate number of error bits
        let error_bits = 128 - error.leading_zeros();
        precision - error_bits >= 32
    }

    proptest! {
    #[test]
        fn test_tick_index_to_sqrt_price (
            tick in MIN_TICK_INDEX..MAX_TICK_INDEX,
        ) {
            let sqrt_price: u128 = tick_index_to_sqrt_price(tick).unwrap().into();

            // Check bounds
            assert!(sqrt_price >= MIN_SQRT_PRICE);
            assert!(sqrt_price <= MAX_SQRT_PRICE);

            // Check the inverted tick has unique price and within bounds
            let minus_tick_price: u128 = tick_index_to_sqrt_price(tick - 1).unwrap().into();
            let plus_tick_price: u128 = tick_index_to_sqrt_price(tick + 1).unwrap().into();
            assert!(minus_tick_price < sqrt_price && sqrt_price < plus_tick_price);

            // Check that sqrt_price_from_tick_index(tick + 1) approximates sqrt(1.0001) * sqrt_price_from_tick_index(tick)
            assert!(within_price_approximation(minus_tick_price, sqrt_price));
            assert!(within_price_approximation(sqrt_price, plus_tick_price));
    }

    #[test]
        fn test_tick_index_from_sqrt_price (
            sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
        ) {
            let tick = sqrt_price_to_tick_index(sqrt_price).unwrap();

            assert!(tick >= MIN_TICK_INDEX);
            assert!(tick < MAX_TICK_INDEX);

            // Check the inverted price from the calculated tick is within tick boundaries
            assert!(sqrt_price >= tick_index_to_sqrt_price(tick).unwrap() && sqrt_price < tick_index_to_sqrt_price(tick + 1).unwrap())
    }

    #[test]
        // Verify that both conversion functions are symmetrical.
        fn test_tick_index_and_sqrt_price_symmetry (
            tick in MIN_TICK_INDEX..MAX_TICK_INDEX
        ) {
            let sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick).unwrap().into();
            let resolved_tick = sqrt_price_to_tick_index(sqrt_price_x64).unwrap();
            assert!(resolved_tick == tick);
        }

        #[test]
        fn test_sqrt_price_from_tick_index_is_sequence (
            tick in (MIN_TICK_INDEX - 1)..MAX_TICK_INDEX
        ) {
            let sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick).unwrap().into();
            let last_sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick - 1).unwrap().into();
            assert!(last_sqrt_price_x64 < sqrt_price_x64);
        }

        #[test]
        fn test_tick_index_from_sqrt_price_is_sequence (
            sqrt_price in (MIN_SQRT_PRICE + 10)..MAX_SQRT_PRICE
        ) {
            let tick = sqrt_price_to_tick_index(sqrt_price).unwrap();
            let last_tick = sqrt_price_to_tick_index(sqrt_price - 10).unwrap();
            assert!(last_tick <= tick);
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_mul_shift_96 {
    use super::*;

    #[test]
    fn test_mul_shift_96_with_max_tick() {
        // Test that mul_shift_96 works correctly with values from MAX_TICK_INDEX
        // This demonstrates that the unwrap() is safe because ticks are bounded
        let sqrt_price_max = get_sqrt_price_positive_tick(MAX_TICK_INDEX);

        // Perform a typical mul_shift_96 operation that would occur during price calculation
        // Using a constant from the tick calculation
        let result = mul_shift_96(sqrt_price_max, 79236085330515764027303304731);

        // The result should be a valid u128 (no overflow)
        assert!(result > 0);
        assert!(result < u128::MAX);
    }

    #[test]
    fn test_mul_shift_96_with_min_tick() {
        // Test that mul_shift_96 works correctly with values from MIN_TICK_INDEX
        // For negative ticks, get_sqrt_price_negative_tick uses different math,
        // but we can still test the mul_shift_96 function with a reasonable value
        let sqrt_price_near_min = 79228162514264337593543950336u128; // Base ratio value

        let result = mul_shift_96(sqrt_price_near_min, 79236085330515764027303304731);

        // The result should be a valid u128 (no overflow)
        assert!(result > 0);
        assert!(result < u128::MAX);
    }

    #[test]
    #[should_panic(expected = "called `Result::unwrap()` on an `Err` value: TryFromIntError(())")]
    fn test_mul_shift_96_overflow_with_unbounded_values() {
        // This test demonstrates that mul_shift_96 CAN overflow with extreme values
        // that would never occur with bounded tick indices.
        // This proves why the unwrap() is safe: tick_index_to_sqrt_price bounds the input.

        // Use extremely large values that would overflow u128 after shift
        // (2^128 - 1) * (2^128 - 1) >> 96 would result in a value > u128::MAX
        let very_large_value = u128::MAX;
        let another_large_value = u128::MAX;

        // This should panic because the result after >> 96 would still be > u128::MAX
        let _ = mul_shift_96(very_large_value, another_large_value);
    }

    #[test]
    fn test_mul_shift_96_result_fits_u128_with_bounded_ticks() {
        // Test various tick values within bounds to show result always fits in u128
        let test_ticks = [
            MIN_TICK_INDEX,
            MIN_TICK_INDEX / 2,
            0,
            MAX_TICK_INDEX / 2,
            MAX_TICK_INDEX,
        ];

        for &tick in &test_ticks {
            let sqrt_price = if tick >= 0 {
                get_sqrt_price_positive_tick(tick)
            } else {
                get_sqrt_price_negative_tick(tick)
            };

            // Perform mul_shift_96 with a typical constant
            let result = mul_shift_96(sqrt_price, 79236085330515764027303304731);

            // Verify the result is valid and fits in u128
            assert!(result > 0);
            assert!(result < u128::MAX);
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_get_initializable_tick_index {
    use super::*;

    const SPACINGS: [u16; 10] = [1, 2, 4, 8, 16, 64, 96, 128, 256, 32896];

    fn nearest_expected(tick: i32, spacing: i32) -> i32 {
        let base = tick.div_euclid(spacing) * spacing;
        let rem = tick.rem_euclid(spacing);
        if rem > 0 && rem >= spacing / 2 {
            base + spacing
        } else {
            base
        }
    }

    #[test]
    fn test_nearest_rounding_multiple_spacings() {
        for &s in &SPACINGS {
            let si = s as i32;
            for t in (-1000i32)..=1000i32 {
                let got = get_initializable_tick_index(t, s, None).unwrap();
                let exp = nearest_expected(t, si);
                assert_eq!(got, exp);
            }
        }
    }

    #[test]
    fn test_round_up_true_behavior() {
        for &s in &SPACINGS {
            let si = s as i32;
            for t in (-100i32)..=100i32 {
                let rem = t.rem_euclid(si);
                let got = get_initializable_tick_index(t, s, Some(true)).unwrap();
                let exp = if rem > 0 {
                    t.div_euclid(si) * si + si
                } else {
                    t
                };
                assert_eq!(got, exp);
            }
        }
    }

    #[test]
    fn test_round_up_false_behavior() {
        for &s in &SPACINGS {
            let si = s as i32;
            for t in (-100i32)..=100i32 {
                let got = get_initializable_tick_index(t, s, Some(false)).unwrap();
                let exp = t.div_euclid(si) * si;
                assert_eq!(got, exp);
            }
        }
    }

    #[test]
    fn test_exact_multiples_remain_stable() {
        for &s in &SPACINGS {
            let si = s as i32;
            for k in -10..=10 {
                let t = k * si;
                assert_eq!(get_initializable_tick_index(t, s, None).unwrap(), t);
                assert_eq!(get_initializable_tick_index(t, s, Some(true)).unwrap(), t);
                assert_eq!(get_initializable_tick_index(t, s, Some(false)).unwrap(), t);
            }
        }
    }

    #[test]
    fn prev_initializable_matches_euclidean_rule() {
        for &s in &SPACINGS {
            let si = s as i32;
            for t in (-1000i32)..=1000i32 {
                let rem = t.rem_euclid(si);
                let expected = if rem == 0 { t - si } else { t - rem };
                let got = get_prev_initializable_tick_index(t, s).unwrap();
                assert_eq!(got, expected, "t={} s={}", t, s);
            }
        }
    }

    #[test]
    fn next_initializable_matches_euclidean_rule() {
        for &s in &SPACINGS {
            let si = s as i32;
            for t in (-1000i32)..=1000i32 {
                let rem = t.rem_euclid(si);
                let expected = t - rem + si;
                let got = get_next_initializable_tick_index(t, s).unwrap();
                assert_eq!(got, expected, "t={} s={}", t, s);
            }
        }
    }

    // Error tests for bounds checking
    #[test]
    fn test_get_initializable_errors_on_tick_below_min() {
        let result = get_initializable_tick_index(MIN_TICK_INDEX - 1, 64, None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_get_initializable_errors_on_tick_above_max() {
        let result = get_initializable_tick_index(MAX_TICK_INDEX + 1, 64, None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_get_initializable_accepts_min_tick() {
        let result = get_initializable_tick_index(MIN_TICK_INDEX, 64, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_initializable_accepts_max_tick() {
        let result = get_initializable_tick_index(MAX_TICK_INDEX, 64, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_prev_errors_on_tick_below_min() {
        let result = get_prev_initializable_tick_index(MIN_TICK_INDEX - 1, 64);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_prev_errors_on_tick_above_max() {
        let result = get_prev_initializable_tick_index(MAX_TICK_INDEX + 1, 64);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_prev_accepts_min_tick() {
        let result = get_prev_initializable_tick_index(MIN_TICK_INDEX, 64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_prev_accepts_max_tick() {
        let result = get_prev_initializable_tick_index(MAX_TICK_INDEX, 64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_next_errors_on_tick_below_min() {
        let result = get_next_initializable_tick_index(MIN_TICK_INDEX - 1, 64);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_next_errors_on_tick_above_max() {
        let result = get_next_initializable_tick_index(MAX_TICK_INDEX + 1, 64);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_next_accepts_min_tick() {
        let result = get_next_initializable_tick_index(MIN_TICK_INDEX, 64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_next_accepts_max_tick() {
        let result = get_next_initializable_tick_index(MAX_TICK_INDEX, 64);
        assert!(result.is_ok());
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_is_tick_index_in_bounds {
    use super::*;

    #[test]
    fn test_min_tick_index() {
        assert!(is_tick_index_in_bounds(MIN_TICK_INDEX));
    }

    #[test]
    fn test_max_tick_index() {
        assert!(is_tick_index_in_bounds(MAX_TICK_INDEX));
    }

    #[test]
    fn test_min_tick_index_sub_1() {
        assert!(!is_tick_index_in_bounds(MIN_TICK_INDEX - 1));
    }

    #[test]
    fn test_max_tick_index_add_1() {
        assert!(!is_tick_index_in_bounds(MAX_TICK_INDEX + 1));
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_is_tick_initializable {
    use super::*;

    const SPACINGS: [u16; 10] = [1, 2, 4, 8, 16, 64, 96, 128, 256, 32896];

    #[test]
    fn true_on_exact_multiples() {
        for &s in &SPACINGS {
            let si = s as i32;
            for k in -10..=10 {
                let tick = k * si;
                assert!(
                    is_tick_initializable(tick, s).unwrap(),
                    "tick={} s={}",
                    tick,
                    s
                );
            }
        }
    }

    #[test]
    fn false_on_non_multiples() {
        for &s in &SPACINGS {
            if s == 1 {
                continue;
            } // all integers are multiples of 1
            let si = s as i32;
            for k in -10..=10 {
                let tick_plus = k * si + 1;
                let tick_minus = k * si - 1;
                assert!(!is_tick_initializable(tick_plus, s).unwrap());
                assert!(!is_tick_initializable(tick_minus, s).unwrap());
            }
        }
    }

    #[test]
    fn test_is_tick_initializable_errors_on_tick_below_min() {
        let result = is_tick_initializable(MIN_TICK_INDEX - 1, 64);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_is_tick_initializable_errors_on_tick_above_max() {
        let result = is_tick_initializable(MAX_TICK_INDEX + 1, 64);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TICK_INDEX_OUT_OF_BOUNDS);
    }

    #[test]
    fn test_is_tick_initializable_accepts_min_tick() {
        let result = is_tick_initializable(MIN_TICK_INDEX, 64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_is_tick_initializable_accepts_max_tick() {
        let result = is_tick_initializable(MAX_TICK_INDEX, 64);
        assert!(result.is_ok());
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_invert_tick_index {
    use super::*;

    #[test]
    fn test_invert_positive_tick_index() {
        assert_eq!(invert_tick_index(100), -100);
    }

    #[test]
    fn test_invert_negative_tick_index() {
        assert_eq!(invert_tick_index(-100), 100);
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_get_full_range_tick_indexes {
    use super::*;

    #[test]
    fn test_min_tick_spacing() {
        let range = get_full_range_tick_indexes(1);
        assert_eq!(range.tick_lower_index, MIN_TICK_INDEX);
        assert_eq!(range.tick_upper_index, MAX_TICK_INDEX);
    }

    #[test]
    fn test_standard_tick_spacing() {
        let spacing: u16 = 128;
        let expected_lower = (MIN_TICK_INDEX / spacing as i32) * spacing as i32;
        let expected_upper = (MAX_TICK_INDEX / spacing as i32) * spacing as i32;
        let range = get_full_range_tick_indexes(spacing);
        assert_eq!(range.tick_lower_index, expected_lower);
        assert_eq!(range.tick_upper_index, expected_upper);
    }

    #[test]
    fn test_full_range_only_tick_spacing() {
        let spacing = FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD;
        let expected_lower = (MIN_TICK_INDEX / spacing as i32) * spacing as i32;
        let expected_upper = (MAX_TICK_INDEX / spacing as i32) * spacing as i32;
        let range = get_full_range_tick_indexes(spacing);
        assert_eq!(range.tick_lower_index, expected_lower);
        assert_eq!(range.tick_upper_index, expected_upper);
    }

    #[test]
    fn test_max_tick_spacing() {
        let spacing = u16::MAX;
        let expected_lower = (MIN_TICK_INDEX / spacing as i32) * spacing as i32;
        let expected_upper = (MAX_TICK_INDEX / spacing as i32) * spacing as i32;
        let range = get_full_range_tick_indexes(spacing);
        assert_eq!(range.tick_lower_index, expected_lower);
        assert_eq!(range.tick_upper_index, expected_upper);
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_order_tick_indexes {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_order_ascending() {
        let r = order_tick_indexes(100, 200);
        assert_eq!(r.tick_lower_index, 100);
        assert_eq!(r.tick_upper_index, 200);
    }

    #[test]
    fn test_order_descending() {
        let r = order_tick_indexes(200, 100);
        assert_eq!(r.tick_lower_index, 100);
        assert_eq!(r.tick_upper_index, 200);
    }

    #[test]
    fn test_order_positive_negative() {
        let r = order_tick_indexes(100, -200);
        assert_eq!(r.tick_lower_index, -200);
        assert_eq!(r.tick_upper_index, 100);
    }

    #[test]
    fn test_order_negative_positive() {
        let r = order_tick_indexes(-100, 200);
        assert_eq!(r.tick_lower_index, -100);
        assert_eq!(r.tick_upper_index, 200);
    }

    #[test]
    fn test_order_both_negative_ascending() {
        let r = order_tick_indexes(-200, -100);
        assert_eq!(r.tick_lower_index, -200);
        assert_eq!(r.tick_upper_index, -100);
    }

    #[test]
    fn test_order_both_negative_descending() {
        let r = order_tick_indexes(-100, -200);
        assert_eq!(r.tick_lower_index, -200);
        assert_eq!(r.tick_upper_index, -100);
    }

    #[test]
    fn test_order_equal_negative() {
        let r = order_tick_indexes(-100, -100);
        assert_eq!(r.tick_lower_index, -100);
        assert_eq!(r.tick_upper_index, -100);
    }

    #[test]
    fn test_order_equal_positive() {
        let r = order_tick_indexes(100, 100);
        assert_eq!(r.tick_lower_index, 100);
        assert_eq!(r.tick_upper_index, 100);
    }

    #[test]
    fn test_order_equal_zero() {
        let r = order_tick_indexes(0, 0);
        assert_eq!(r.tick_lower_index, 0);
        assert_eq!(r.tick_upper_index, 0);
    }

    proptest! {
        #[test]
        fn prop_min_max(a in i32::MIN..i32::MAX, b in i32::MIN..i32::MAX) {
            let r = order_tick_indexes(a, b);
            let lo = a.min(b);
            let hi = a.max(b);
            prop_assert_eq!(r.tick_lower_index, lo);
            prop_assert_eq!(r.tick_upper_index, hi);
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_is_full_range_only_flag {
    use super::*;

    #[test]
    fn at_threshold_is_true() {
        assert!(is_full_range_only(FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD));
    }

    #[test]
    fn below_threshold_is_false() {
        assert!(!is_full_range_only(
            FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD - 1
        ));
    }

    #[test]
    fn above_threshold_is_true() {
        assert!(is_full_range_only(
            FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD + 1
        ));
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_get_tick_index_in_array {
    use super::*;
    use crate::TICK_ARRAY_SIZE;

    const SPACINGS: [u16; 10] = [1, 2, 4, 8, 16, 64, 96, 128, 256, 32896];

    #[test]
    fn start0_all_inner_offsets_map_correctly() {
        for &s in &SPACINGS {
            let si = s as i32;
            let start0 = 0i32;
            for inner in 0..(TICK_ARRAY_SIZE as i32) {
                let tick = start0 + inner * si;
                let got = get_tick_index_in_array(tick, start0, s);
                assert_eq!(got, Ok(inner as u32));
            }
        }
    }

    #[test]
    fn start0_lower_bound_is_err() {
        for &s in &SPACINGS {
            let si = s as i32;
            let _ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start0 = 0i32;
            assert_eq!(
                get_tick_index_in_array(start0 - 1, start0, s),
                Err(TICK_INDEX_NOT_IN_ARRAY)
            );
        }
    }

    #[test]
    fn start0_upper_bound_is_err() {
        for &s in &SPACINGS {
            let si = s as i32;
            let ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start0 = 0i32;
            assert_eq!(
                get_tick_index_in_array(start0 + ticks_in_array, start0, s),
                Err(TICK_INDEX_NOT_IN_ARRAY)
            );
        }
    }

    #[test]
    fn start0_last_valid_is_last_index() {
        for &s in &SPACINGS {
            let si = s as i32;
            let ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start0 = 0i32;
            assert_eq!(
                get_tick_index_in_array(start0 + ticks_in_array - si, start0, s),
                Ok((TICK_ARRAY_SIZE - 1) as u32)
            );
        }
    }

    #[test]
    fn start_neg_array_all_inner_offsets_map_correctly() {
        for &s in &SPACINGS {
            let si = s as i32;
            let ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start_neg = -ticks_in_array;
            for inner in 0..(TICK_ARRAY_SIZE as i32) {
                let tick = start_neg + inner * si;
                let got = get_tick_index_in_array(tick, start_neg, s);
                assert_eq!(got, Ok(inner as u32));
            }
        }
    }

    #[test]
    fn start_neg_array_lower_bound_is_err() {
        for &s in &SPACINGS {
            let si = s as i32;
            let ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start_neg = -ticks_in_array;
            assert_eq!(
                get_tick_index_in_array(start_neg - 1, start_neg, s),
                Err(TICK_INDEX_NOT_IN_ARRAY)
            );
        }
    }

    #[test]
    fn start_neg_array_upper_bound_is_err() {
        for &s in &SPACINGS {
            let si = s as i32;
            let ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start_neg = -ticks_in_array;
            assert_eq!(
                get_tick_index_in_array(start_neg + ticks_in_array, start_neg, s),
                Err(TICK_INDEX_NOT_IN_ARRAY)
            );
        }
    }

    #[test]
    fn start_neg_array_last_valid_is_last_index() {
        for &s in &SPACINGS {
            let si = s as i32;
            let ticks_in_array = (TICK_ARRAY_SIZE as i32) * si;
            let start_neg = -ticks_in_array;
            assert_eq!(
                get_tick_index_in_array(start_neg + ticks_in_array - si, start_neg, s),
                Ok((TICK_ARRAY_SIZE - 1) as u32)
            );
        }
    }
}
