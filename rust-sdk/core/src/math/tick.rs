use ethnum::U256;

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::{
    CoreError, TickRange, FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD, MAX_TICK_INDEX, MIN_TICK_INDEX,
    NUMBER_DOWN_CAST_ERROR, TICK_ARRAY_SIZE, TICK_INDEX_NOT_IN_ARRAY, U128,
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
/// This function will make panic for zero sqrt price.
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
        // then the actual tick_high has to be higher than tick_high.
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
/// - A i32 representing the initializable tick index (rounded per round_up or nearest).
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
        remainder >= tick_spacing_i32 / 2 && remainder > 0
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

fn u256_to_u128_checked(value: &U256) -> Result<u128, CoreError> {
    if *value.high() != U256::ZERO {
        Err(NUMBER_DOWN_CAST_ERROR)
    } else {
        Ok(value.as_u128())
    }
}

fn mul_shift_96(n0: u128, n1: u128) -> u128 {
    let mul: U256 = (<U256>::from(n0) * <U256>::from(n1)) >> 96;
    u256_to_u128_checked(&mul).unwrap()
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

    #[test]
    #[should_panic(expected = "Unable to down cast number")]
    fn test_tick_exceed_max() {
        let sqrt_price_from_max_tick_add_one = tick_index_to_sqrt_price(MAX_TICK_INDEX + 1);
        let sqrt_price_from_max_tick = tick_index_to_sqrt_price(MAX_TICK_INDEX);
        assert!(sqrt_price_from_max_tick_add_one > sqrt_price_from_max_tick);
    }

    #[test]
    fn test_tick_below_min() {
        let sqrt_price_from_min_tick_sub_one = tick_index_to_sqrt_price(MIN_TICK_INDEX - 1);
        let sqrt_price_from_min_tick = tick_index_to_sqrt_price(MIN_TICK_INDEX);
        assert!(sqrt_price_from_min_tick_sub_one < sqrt_price_from_min_tick);
    }

    #[test]
    fn test_tick_at_max() {
        let max_tick = MAX_TICK_INDEX;
        let r = tick_index_to_sqrt_price(max_tick);
        assert_eq!(r, MAX_SQRT_PRICE);
    }

    #[test]
    fn test_tick_at_min() {
        let min_tick = MIN_TICK_INDEX;
        let r = tick_index_to_sqrt_price(min_tick);
        assert_eq!(r, MIN_SQRT_PRICE);
    }

    #[test]
    fn test_exact_bit_values() {
        let conditions = &[
            (
                0i32,
                18446744073709551616u128,
                18446744073709551616u128,
                "0x0",
            ),
            (
                1i32,
                18447666387855959850u128,
                18445821805675392311u128,
                "0x1",
            ),
            (
                2i32,
                18448588748116922571u128,
                18444899583751176498u128,
                "0x2",
            ),
            (
                4i32,
                18450433606991734263u128,
                18443055278223354162u128,
                "0x4",
            ),
            (
                8i32,
                18454123878217468680u128,
                18439367220385604838u128,
                "0x8",
            ),
            (
                16i32,
                18461506635090006701u128,
                18431993317065449817u128,
                "0x10",
            ),
            (
                32i32,
                18476281010653910144u128,
                18417254355718160513u128,
                "0x20",
            ),
            (
                64i32,
                18505865242158250041u128,
                18387811781193591352u128,
                "0x40",
            ),
            (
                128i32,
                18565175891880433522u128,
                18329067761203520168u128,
                "0x80",
            ),
            (
                256i32,
                18684368066214940582u128,
                18212142134806087854u128,
                "0x100",
            ),
            (
                512i32,
                18925053041275764671u128,
                17980523815641551639u128,
                "0x200",
            ),
            (
                1024i32,
                19415764168677886926u128,
                17526086738831147013u128,
                "0x400",
            ),
            (
                2048i32,
                20435687552633177494u128,
                16651378430235024244u128,
                "0x800",
            ),
            (
                4096i32,
                22639080592224303007u128,
                15030750278693429944u128,
                "0x1000",
            ),
            (
                8192i32,
                27784196929998399742u128,
                12247334978882834399u128,
                "0x2000",
            ),
            (
                16384i32,
                41848122137994986128u128,
                8131365268884726200u128,
                "0x4000",
            ),
            (
                32768i32,
                94936283578220370716u128,
                3584323654723342297u128,
                "0x8000",
            ),
            (
                65536i32,
                488590176327622479860u128,
                696457651847595233u128,
                "0x10000",
            ),
            (
                131072i32,
                12941056668319229769860u128,
                26294789957452057u128,
                "0x20000",
            ),
            (
                262144i32,
                9078618265828848800676189u128,
                37481735321082u128,
                "0x40000",
            ),
        ];

        for (p_tick, expected, neg_expected, _desc) in conditions {
            let p_result = tick_index_to_sqrt_price(*p_tick);
            let n_tick = -*p_tick;
            let n_result = tick_index_to_sqrt_price(n_tick);
            assert_eq!(p_result, *expected);
            assert_eq!(n_result, *neg_expected);
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_sqrt_price_to_tick_index {
    use super::*;
    use crate::{MAX_SQRT_PRICE, MAX_TICK_INDEX, MIN_SQRT_PRICE, MIN_TICK_INDEX};

    #[test]
    fn test_sqrt_price_to_tick_index_at_max() {
        let r = sqrt_price_to_tick_index(MAX_SQRT_PRICE);
        assert_eq!(&r, &MAX_TICK_INDEX);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_min() {
        let r = sqrt_price_to_tick_index(MIN_SQRT_PRICE);
        assert_eq!(&r, &MIN_TICK_INDEX);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_max_add_one() {
        let sqrt_price_x64_max_add_one = MAX_SQRT_PRICE + 1;
        let tick_from_max_add_one = sqrt_price_to_tick_index(sqrt_price_x64_max_add_one);
        let sqrt_price_x64_max = MAX_SQRT_PRICE;
        let tick_from_max = sqrt_price_to_tick_index(sqrt_price_x64_max);
        // We don't care about accuracy over the limit. We just care about it's equality properties.
        assert!(tick_from_max_add_one >= tick_from_max);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_min_add_one() {
        let sqrt_price_x64 = MIN_SQRT_PRICE + 1;
        let r = sqrt_price_to_tick_index(sqrt_price_x64);
        assert_eq!(&r, &(MIN_TICK_INDEX));
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_max_sub_one() {
        let sqrt_price_x64 = MAX_SQRT_PRICE - 1;
        let r = sqrt_price_to_tick_index(sqrt_price_x64);
        assert_eq!(&r, &(MAX_TICK_INDEX - 1));
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_min_sub_one() {
        let sqrt_price_x64_min_sub_one = MIN_SQRT_PRICE - 1;
        let tick_from_min_sub_one = sqrt_price_to_tick_index(sqrt_price_x64_min_sub_one);
        let sqrt_price_x64_min = MIN_SQRT_PRICE + 1;
        let tick_from_min = sqrt_price_to_tick_index(sqrt_price_x64_min);
        assert!(tick_from_min_sub_one < tick_from_min);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_one() {
        let sqrt_price_x64: u128 = u64::MAX as u128 + 1;
        let r = sqrt_price_to_tick_index(sqrt_price_x64);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_one_add_one() {
        let sqrt_price_x64: u128 = u64::MAX as u128 + 2;
        let r = sqrt_price_to_tick_index(sqrt_price_x64);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_sqrt_price_to_tick_index_at_one_sub_one() {
        let sqrt_price_x64: u128 = u64::MAX.into();
        let r = sqrt_price_to_tick_index(sqrt_price_x64);
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
            let sqrt_price: u128 = tick_index_to_sqrt_price(tick).into();

            // Check bounds
            assert!(sqrt_price >= MIN_SQRT_PRICE);
            assert!(sqrt_price <= MAX_SQRT_PRICE);

            // Check the inverted tick has unique price and within bounds
            let minus_tick_price: u128 = tick_index_to_sqrt_price(tick - 1).into();
            let plus_tick_price: u128 = tick_index_to_sqrt_price(tick + 1).into();
            assert!(minus_tick_price < sqrt_price && sqrt_price < plus_tick_price);

            // Check that sqrt_price_from_tick_index(tick + 1) approximates sqrt(1.0001) * sqrt_price_from_tick_index(tick)
            assert!(within_price_approximation(minus_tick_price, sqrt_price));
            assert!(within_price_approximation(sqrt_price, plus_tick_price));
    }

    #[test]
        fn test_tick_index_from_sqrt_price (
            sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
        ) {
            let tick = sqrt_price_to_tick_index(sqrt_price);

            assert!(tick >= MIN_TICK_INDEX);
            assert!(tick < MAX_TICK_INDEX);

            // Check the inverted price from the calculated tick is within tick boundaries
            assert!(sqrt_price >= tick_index_to_sqrt_price(tick) && sqrt_price < tick_index_to_sqrt_price(tick + 1))
    }

    #[test]
        // Verify that both conversion functions are symmetrical.
        fn test_tick_index_and_sqrt_price_symmetry (
            tick in MIN_TICK_INDEX..MAX_TICK_INDEX
        ) {
            let sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick).into();
            let resolved_tick = sqrt_price_to_tick_index(sqrt_price_x64);
            assert!(resolved_tick == tick);
        }

        #[test]
        fn test_sqrt_price_from_tick_index_is_sequence (
            tick in (MIN_TICK_INDEX - 1)..MAX_TICK_INDEX
        ) {
            let sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick).into();
            let last_sqrt_price_x64: u128 = tick_index_to_sqrt_price(tick - 1).into();
            assert!(last_sqrt_price_x64 < sqrt_price_x64);
        }

        #[test]
        fn test_tick_index_from_sqrt_price_is_sequence (
            sqrt_price in (MIN_SQRT_PRICE + 10)..MAX_SQRT_PRICE
        ) {
            let tick = sqrt_price_to_tick_index(sqrt_price);
            let last_tick = sqrt_price_to_tick_index(sqrt_price - 10);
            assert!(last_tick <= tick);
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test_get_initializable_tick_index {
    use super::*;

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
        let spacings = [1, 2, 4, 8, 16, 64, 96, 128, 256];
        for &s in &spacings {
            let si = s as i32;
            for t in (-1000i32)..=1000i32 {
                let got = get_initializable_tick_index(t, s, None);
                let exp = nearest_expected(t, si);
                assert_eq!(got, exp);
            }
        }
    }

    #[test]
    fn test_round_up_true_behavior() {
        let spacings = [1, 2, 4, 8, 16, 64, 96, 128, 256];
        for &s in &spacings {
            let si = s as i32;
            for t in (-500i32)..=500i32 {
                let rem = t.rem_euclid(si);
                let got = get_initializable_tick_index(t, s, Some(true));
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
        let spacings = [1, 2, 4, 8, 16, 64, 96, 128, 256];
        for &s in &spacings {
            let si = s as i32;
            for t in (-500i32)..=500i32 {
                let got = get_initializable_tick_index(t, s, Some(false));
                let exp = t.div_euclid(si) * si;
                assert_eq!(got, exp);
            }
        }
    }

    #[test]
    fn test_exact_multiples_remain_stable() {
        let spacings = [1, 2, 4, 8, 16, 64, 96, 128, 256];
        for &s in &spacings {
            let si = s as i32;
            for k in -20..=20 {
                let t = k * si;
                assert_eq!(get_initializable_tick_index(t, s, None), t);
                assert_eq!(get_initializable_tick_index(t, s, Some(true)), t);
                assert_eq!(get_initializable_tick_index(t, s, Some(false)), t);
            }
        }
    }

    #[test]
    fn prev_initializable_matches_euclidean_rule() {
        let spacings = [1, 3, 10, 16, 128];
        for &s in &spacings {
            let si = s as i32;
            for t in (-1000i32)..=1000i32 {
                let rem = t.rem_euclid(si);
                let expected = if rem == 0 { t - si } else { t - rem };
                let got = get_prev_initializable_tick_index(t, s);
                assert_eq!(got, expected, "t={} s={}", t, s);
            }
        }
    }

    #[test]
    fn next_initializable_matches_euclidean_rule() {
        let spacings = [1, 3, 10, 16, 128];
        for &s in &spacings {
            let si = s as i32;
            for t in (-1000i32)..=1000i32 {
                let rem = t.rem_euclid(si);
                let expected = t - rem + si;
                let got = get_next_initializable_tick_index(t, s);
                assert_eq!(got, expected, "t={} s={}", t, s);
            }
        }
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
mod test_is_tick_initializable {}

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
mod tests {
    use super::*;
    use crate::{MAX_SQRT_PRICE, MIN_SQRT_PRICE};

    #[test]
    fn test_is_tick_initializable() {
        assert!(is_tick_initializable(100, 10));
        assert!(!is_tick_initializable(105, 10));
    }

    #[test]
    fn test_get_tick_index_in_array() {
        assert_eq!(get_tick_index_in_array(0, 0, 10), Ok(0));
        assert_eq!(get_tick_index_in_array(100, 0, 10), Ok(10));
        assert_eq!(get_tick_index_in_array(50, 0, 10), Ok(5));
        assert_eq!(get_tick_index_in_array(-830, -880, 10), Ok(5));
        assert_eq!(get_tick_index_in_array(-780, -880, 10), Ok(10));
        assert_eq!(
            get_tick_index_in_array(880, 0, 10),
            Err(TICK_INDEX_NOT_IN_ARRAY)
        );
        assert_eq!(
            get_tick_index_in_array(-1, 0, 10),
            Err(TICK_INDEX_NOT_IN_ARRAY)
        );
        assert_eq!(
            get_tick_index_in_array(-881, -880, 10),
            Err(TICK_INDEX_NOT_IN_ARRAY)
        );
        assert_eq!(get_tick_index_in_array(2861952, 0, 32896), Ok(87));
        assert_eq!(get_tick_index_in_array(-32896, -2894848, 32896), Ok(87));
    }
}
