use crate::math::u256_math::*;
use std::convert::TryInto;

// Max/Min sqrt_price derived from max/min tick-index
pub const MAX_SQRT_PRICE_X64: u128 = 79226673515401279992447579055;
pub const MIN_SQRT_PRICE_X64: u128 = 4295048016;

const LOG_B_2_X32: i128 = 59543866431248i128;
const BIT_PRECISION: u32 = 14;
const LOG_B_P_ERR_MARGIN_LOWER_X64: i128 = 184467440737095516i128; // 0.01
const LOG_B_P_ERR_MARGIN_UPPER_X64: i128 = 15793534762490258745i128; // 2^-precision / log_2_b + 0.01

pub const FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD: u16 = 32768; // 2^15

/// Derive the sqrt-price from a tick index. The precision of this method is only guarranted
/// if tick is within the bounds of {max, min} tick-index.
///
/// # Parameters
/// - `tick` - A i32 integer representing the tick integer
///
/// # Returns
/// - `Ok`: A u128 Q32.64 representing the sqrt_price
pub fn sqrt_price_from_tick_index(tick: i32) -> u128 {
    if tick >= 0 {
        get_sqrt_price_positive_tick(tick)
    } else {
        get_sqrt_price_negative_tick(tick)
    }
}

/// Derive the tick-index from a sqrt-price. The precision of this method is only guarranted
/// if sqrt-price is within the bounds of {max, min} sqrt-price.
///
/// # Parameters
/// - `sqrt_price_x64` - A u128 Q64.64 integer representing the sqrt-price
///
/// # Returns
/// - An i32 representing the tick_index of the provided sqrt-price
pub fn tick_index_from_sqrt_price(sqrt_price_x64: &u128) -> i32 {
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
    let tick_low: i32 = ((logbp_x64 - LOG_B_P_ERR_MARGIN_LOWER_X64) >> 64)
        .try_into()
        .unwrap();
    let tick_high: i32 = ((logbp_x64 + LOG_B_P_ERR_MARGIN_UPPER_X64) >> 64)
        .try_into()
        .unwrap();

    if tick_low == tick_high {
        tick_low
    } else {
        // If our estimation for tick_high returns a lower sqrt_price than the input
        // then the actual tick_high has to be higher than tick_high.
        // Otherwise, the actual value is between tick_low & tick_high, so a floor value
        // (tick_low) is returned
        let actual_tick_high_sqrt_price_x64: u128 = sqrt_price_from_tick_index(tick_high);
        if actual_tick_high_sqrt_price_x64 <= *sqrt_price_x64 {
            tick_high
        } else {
            tick_low
        }
    }
}

fn mul_shift_96(n0: u128, n1: u128) -> u128 {
    mul_u256(n0, n1).shift_right(96).try_into_u128().unwrap()
}

// Performs the exponential conversion with Q64.64 precision
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

#[cfg(test)]
mod fuzz_tests {

    use super::*;
    use crate::{
        math::U256,
        state::{MAX_TICK_INDEX, MIN_TICK_INDEX},
    };
    use proptest::prelude::*;

    fn within_price_approximation(lower: u128, upper: u128) -> bool {
        let precision = 96;
        // We increase the resolution of upper to find ratio_x96
        let x = U256::from(upper) << precision;
        let y = U256::from(lower);

        // (1.0001 ^ 0.5) << 96 (precision)
        let sqrt_10001_x96 = 79232123823359799118286999567u128;

        // This ratio should be as close to sqrt_10001_x96 as possible
        let ratio_x96 = x.div_mod(y).0.as_u128();

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
            let sqrt_price = sqrt_price_from_tick_index(tick);

            // Check bounds
            assert!(sqrt_price >= MIN_SQRT_PRICE_X64);
            assert!(sqrt_price <= MAX_SQRT_PRICE_X64);

            // Check the inverted tick has unique price and within bounds
            let minus_tick_price = sqrt_price_from_tick_index(tick - 1);
            let plus_tick_price = sqrt_price_from_tick_index(tick + 1);
            assert!(minus_tick_price < sqrt_price && sqrt_price < plus_tick_price);

            // Check that sqrt_price_from_tick_index(tick + 1) approximates sqrt(1.0001) * sqrt_price_from_tick_index(tick)
            assert!(within_price_approximation(minus_tick_price, sqrt_price));
            assert!(within_price_approximation(sqrt_price, plus_tick_price));
        }

        #[test]
        fn test_tick_index_from_sqrt_price (
            sqrt_price in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64
        ) {
            let tick = tick_index_from_sqrt_price(&sqrt_price);

            // Check bounds
            assert!(tick >= MIN_TICK_INDEX);
            assert!(tick < MAX_TICK_INDEX);

            // Check the inverted price from the calculated tick is within tick boundaries
            assert!(sqrt_price >= sqrt_price_from_tick_index(tick) && sqrt_price < sqrt_price_from_tick_index(tick + 1))
        }

        #[test]
        // Verify that both conversion functions are symmetrical.
        fn test_tick_index_and_sqrt_price_symmetry (
            tick in MIN_TICK_INDEX..MAX_TICK_INDEX
        ) {

            let sqrt_price_x64 = sqrt_price_from_tick_index(tick);
            let resolved_tick = tick_index_from_sqrt_price(&sqrt_price_x64);
            assert!(resolved_tick == tick);
        }


        #[test]
        fn test_sqrt_price_from_tick_index_is_sequence (
            tick in MIN_TICK_INDEX-1..MAX_TICK_INDEX
        ) {

            let sqrt_price_x64 = sqrt_price_from_tick_index(tick);
            let last_sqrt_price_x64 = sqrt_price_from_tick_index(tick-1);
            assert!(last_sqrt_price_x64 < sqrt_price_x64);
        }

        #[test]
        fn test_tick_index_from_sqrt_price_is_sequence (
            sqrt_price in (MIN_SQRT_PRICE_X64 + 10)..MAX_SQRT_PRICE_X64
        ) {

            let tick = tick_index_from_sqrt_price(&sqrt_price);
            let last_tick = tick_index_from_sqrt_price(&(sqrt_price - 10));
            assert!(last_tick <= tick);
        }
    }
}

#[cfg(test)]
mod test_tick_index_from_sqrt_price {
    use super::*;
    use crate::state::{MAX_TICK_INDEX, MIN_TICK_INDEX};

    #[test]
    fn test_tick_index_from_sqrt_price_at_max() {
        let r = tick_index_from_sqrt_price(&MAX_SQRT_PRICE_X64);
        assert_eq!(&r, &MAX_TICK_INDEX);
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_min() {
        let r = tick_index_from_sqrt_price(&MIN_SQRT_PRICE_X64);
        assert_eq!(&r, &MIN_TICK_INDEX);
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_max_add_one() {
        let sqrt_price_x64_max_add_one = MAX_SQRT_PRICE_X64 + 1;
        let tick_from_max_add_one = tick_index_from_sqrt_price(&sqrt_price_x64_max_add_one);
        let sqrt_price_x64_max = MAX_SQRT_PRICE_X64;
        let tick_from_max = tick_index_from_sqrt_price(&sqrt_price_x64_max);

        // We don't care about accuracy over the limit. We just care about it's equality properties.
        assert!(tick_from_max_add_one >= tick_from_max);
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_min_add_one() {
        let sqrt_price_x64 = MIN_SQRT_PRICE_X64 + 1;
        let r = tick_index_from_sqrt_price(&sqrt_price_x64);
        assert_eq!(&r, &(MIN_TICK_INDEX));
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_max_sub_one() {
        let sqrt_price_x64 = MAX_SQRT_PRICE_X64 - 1;
        let r = tick_index_from_sqrt_price(&sqrt_price_x64);
        assert_eq!(&r, &(MAX_TICK_INDEX - 1));
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_min_sub_one() {
        let sqrt_price_x64_min_sub_one = MIN_SQRT_PRICE_X64 - 1;
        let tick_from_min_sub_one = tick_index_from_sqrt_price(&sqrt_price_x64_min_sub_one);
        let sqrt_price_x64_min = MIN_SQRT_PRICE_X64 + 1;
        let tick_from_min = tick_index_from_sqrt_price(&sqrt_price_x64_min);

        // We don't care about accuracy over the limit. We just care about it's equality properties.
        assert!(tick_from_min_sub_one < tick_from_min);
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_one() {
        let sqrt_price_x64: u128 = u64::MAX as u128 + 1;
        let r = tick_index_from_sqrt_price(&sqrt_price_x64);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_one_add_one() {
        let sqrt_price_x64: u128 = u64::MAX as u128 + 2;
        let r = tick_index_from_sqrt_price(&sqrt_price_x64);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_tick_index_from_sqrt_price_at_one_sub_one() {
        let sqrt_price_x64: u128 = u64::MAX.into();
        let r = tick_index_from_sqrt_price(&sqrt_price_x64);
        assert_eq!(r, -1);
    }
}

#[cfg(test)]
mod sqrt_price_from_tick_index_tests {
    use super::*;
    use crate::state::{MAX_TICK_INDEX, MIN_TICK_INDEX};

    #[test]
    #[should_panic(expected = "NumberDownCastError")]
    // There should never be a use-case where we call this method with an out of bound index
    fn test_tick_exceed_max() {
        let sqrt_price_from_max_tick_add_one = sqrt_price_from_tick_index(MAX_TICK_INDEX + 1);
        let sqrt_price_from_max_tick = sqrt_price_from_tick_index(MAX_TICK_INDEX);
        assert!(sqrt_price_from_max_tick_add_one > sqrt_price_from_max_tick);
    }

    #[test]
    fn test_tick_below_min() {
        let sqrt_price_from_min_tick_sub_one = sqrt_price_from_tick_index(MIN_TICK_INDEX - 1);
        let sqrt_price_from_min_tick = sqrt_price_from_tick_index(MIN_TICK_INDEX);
        assert!(sqrt_price_from_min_tick_sub_one < sqrt_price_from_min_tick);
    }

    #[test]
    fn test_tick_at_max() {
        let max_tick = MAX_TICK_INDEX;
        let r = sqrt_price_from_tick_index(max_tick);
        assert_eq!(r, MAX_SQRT_PRICE_X64);
    }

    #[test]
    fn test_tick_at_min() {
        let min_tick = MIN_TICK_INDEX;
        let r = sqrt_price_from_tick_index(min_tick);
        assert_eq!(r, MIN_SQRT_PRICE_X64);
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

        for (p_tick, expected, neg_expected, desc) in conditions {
            let p_result = sqrt_price_from_tick_index(*p_tick);
            let n_tick = -p_tick;
            let n_result = sqrt_price_from_tick_index(n_tick);
            assert_eq!(
                p_result, *expected,
                "Assert positive tick equals expected value on binary fraction bit = {} ",
                desc
            );
            assert_eq!(
                n_result, *neg_expected,
                "Assert negative tick equals expected value on binary fraction bit = {} ",
                desc
            );
        }
    }
}
