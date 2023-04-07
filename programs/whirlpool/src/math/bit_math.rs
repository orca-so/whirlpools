use crate::errors::ErrorCode;

use super::U256Muldiv;

pub const Q64_RESOLUTION: u8 = 64;
pub const TO_Q64: u128 = 1u128 << Q64_RESOLUTION;

pub fn checked_mul_div(n0: u128, n1: u128, d: u128) -> Result<u128, ErrorCode> {
    checked_mul_div_round_up_if(n0, n1, d, false)
}

pub fn checked_mul_div_round_up(n0: u128, n1: u128, d: u128) -> Result<u128, ErrorCode> {
    checked_mul_div_round_up_if(n0, n1, d, true)
}

pub fn checked_mul_div_round_up_if(
    n0: u128,
    n1: u128,
    d: u128,
    round_up: bool,
) -> Result<u128, ErrorCode> {
    if d == 0 {
        return Err(ErrorCode::DivideByZero);
    }

    let p = n0.checked_mul(n1).ok_or(ErrorCode::MulDivOverflow)?;
    let n = p / d;

    Ok(if round_up && p % d > 0 { n + 1 } else { n })
}

pub fn checked_mul_shift_right(n0: u128, n1: u128) -> Result<u64, ErrorCode> {
    checked_mul_shift_right_round_up_if(n0, n1, false)
}

const Q64_MASK: u128 = 0xFFFF_FFFF_FFFF_FFFF;

/// Multiplies an integer u128 and a Q64.64 fixed point number.
/// Returns a product represented as a u64 integer.
pub fn checked_mul_shift_right_round_up_if(
    n0: u128,
    n1: u128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    if n0 == 0 || n1 == 0 {
        return Ok(0);
    }

    let p = n0
        .checked_mul(n1)
        .ok_or(ErrorCode::MultiplicationShiftRightOverflow)?;

    let result = (p >> Q64_RESOLUTION) as u64;

    let should_round = round_up && (p & Q64_MASK > 0);
    if should_round && result == u64::MAX {
        return Err(ErrorCode::MultiplicationOverflow);
    }

    Ok(if should_round { result + 1 } else { result })
}

pub fn div_round_up(n: u128, d: u128) -> Result<u128, ErrorCode> {
    div_round_up_if(n, d, true)
}

pub fn div_round_up_if(n: u128, d: u128, round_up: bool) -> Result<u128, ErrorCode> {
    if d == 0 {
        return Err(ErrorCode::DivideByZero);
    }

    let q = n / d;

    Ok(if round_up && n % d > 0 { q + 1 } else { q })
}

pub fn div_round_up_if_u256(
    n: U256Muldiv,
    d: U256Muldiv,
    round_up: bool,
) -> Result<u128, ErrorCode> {
    let (quotient, remainder) = n.div(d, round_up);

    let result = if round_up && !remainder.is_zero() {
        quotient.add(U256Muldiv::new(0, 1))
    } else {
        quotient
    };

    Ok(result.try_into_u128()?)
}

#[cfg(test)]
mod fuzz_tests {
    use crate::math::U256;

    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_div_round_up_if(
            n in 0..u128::MAX,
            d in 0..u128::MAX,
        ) {
            let rounded = div_round_up(n, d);
            if d == 0 {
                assert!(rounded.is_err());
            } else {
                let unrounded = n / d;
                let div_unrounded = div_round_up_if(n, d, false).unwrap();
                let diff = rounded.unwrap() - unrounded;
                assert!(unrounded == div_unrounded);
                assert!(diff <= 1);
                assert!((diff == 1) == (n % d > 0));
            }
        }


        #[test]
        fn test_div_round_up_if_u256(
            n_hi in 0..u128::MAX,
            n_lo in 0..u128::MAX,
            d_hi in 0..u128::MAX,
            d_lo in 0..u128::MAX,
        ) {
            let dividend = U256Muldiv::new(n_hi, n_lo);
            let divisor = U256Muldiv::new(d_hi, d_lo);

            let rounded = div_round_up_if_u256(dividend, divisor, true);
            let (quotient, _) = dividend.div(divisor, true);

            if quotient.try_into_u128().is_err() {
                assert!(rounded.is_err());
            } else {
                let other_dividend = (U256::from(n_hi) << 128) + U256::from(n_lo);
                let other_divisor = (U256::from(d_hi) << 128) + U256::from(d_lo);
                let other_quotient = other_dividend / other_divisor;
                let other_remainder = other_dividend % other_divisor;

                let unrounded = div_round_up_if_u256(dividend, divisor, false);
                assert!(unrounded.unwrap() == other_quotient.try_into_u128().unwrap());

                let diff = rounded.unwrap() - unrounded.unwrap();
                assert!(diff <= 1);
                assert!((diff == 1) == (other_remainder > U256::zero()));
            }
        }

        #[test]
        fn test_checked_mul_div_round_up_if(n0 in 0..u128::MAX, n1 in 0..u128::MAX, d in 0..u128::MAX) {
            let result = checked_mul_div_round_up_if(n0, n1, d, true);

            if d == 0 {
                assert!(result.is_err());
            } else if n0.checked_mul(n1).is_none() {
                assert!(result.is_err());
            } else {
                let other_n0 = U256::from(n0);
                let other_n1 = U256::from(n1);
                let other_p = other_n0 * other_n1;
                let other_d = U256::from(d);
                let other_result = other_p / other_d;

                let unrounded = checked_mul_div_round_up_if(n0, n1, d, false).unwrap();
                assert!(U256::from(unrounded) == other_result);

                let diff = U256::from(result.unwrap()) - other_result;
                assert!(diff <= U256::from(1));
                assert!((diff == U256::from(1)) == (other_p % other_d > U256::from(0)));
            }
        }

        #[test]
        fn test_mul_shift_right_round_up_if(n0 in 0..u128::MAX, n1 in 0..u128::MAX) {
            let result = checked_mul_shift_right_round_up_if(n0, n1, true);

            if n0.checked_mul(n1).is_none() {
                assert!(result.is_err());
            } else {
                let p = (U256::from(n0) * U256::from(n1)).try_into_u128().unwrap();

                let i = (p >> 64) as u64;


                assert!(i == checked_mul_shift_right_round_up_if(n0, n1, false).unwrap());

                if i == u64::MAX && (p & Q64_MASK > 0) {
                    assert!(result.is_err());
                } else {
                    let diff = result.unwrap() - i;
                    assert!(diff <= 1);
                    assert!((diff == 1) == (p % (u64::MAX as u128) > 0));
                }
            }
        }
    }
}

#[cfg(test)]
mod test_bit_math {
    // We arbitrarily select integers a, b, d < 2^128 - 1, such that 2^128 - 1 < (a * b / d) < 2^128
    // For simplicity we fix d = 2 and the target to be 2^128 - 0.5
    // We then solve for a * b = 2^129 - 1
    const MAX_FLOOR: (u128, u128, u128) = (11053036065049294753459639, 61572651155449, 2);

    mod test_mul_div {
        use crate::math::checked_mul_div;

        use super::MAX_FLOOR;

        #[test]
        fn test_mul_div_ok() {
            assert_eq!(checked_mul_div(150, 30, 3).unwrap(), 1500);
            assert_eq!(checked_mul_div(15, 0, 10).unwrap(), 0);
        }

        #[test]
        fn test_mul_div_shift_ok() {
            assert_eq!(checked_mul_div(u128::MAX, 1, 2).unwrap(), u128::MAX >> 1);
            assert_eq!(checked_mul_div(u128::MAX, 1, 4).unwrap(), u128::MAX >> 2);
            assert_eq!(checked_mul_div(u128::MAX, 1, 8).unwrap(), u128::MAX >> 3);
            assert_eq!(checked_mul_div(u128::MAX, 1, 16).unwrap(), u128::MAX >> 4);
            assert_eq!(checked_mul_div(u128::MAX, 1, 32).unwrap(), u128::MAX >> 5);
            assert_eq!(checked_mul_div(u128::MAX, 1, 64).unwrap(), u128::MAX >> 6);
        }

        #[test]
        fn test_mul_div_large_ok() {
            assert_eq!(
                checked_mul_div(u128::MAX, 1, u128::from(u64::MAX) + 1).unwrap(),
                u64::MAX.into()
            );
            assert_eq!(checked_mul_div(u128::MAX - 1, 1, u128::MAX).unwrap(), 0);
        }

        #[test]
        fn test_mul_div_overflows() {
            assert!(checked_mul_div(u128::MAX, 2, u128::MAX).is_err());
            assert!(checked_mul_div(u128::MAX, u128::MAX, u128::MAX).is_err());
            assert!(checked_mul_div(u128::MAX, u128::MAX - 1, u128::MAX).is_err());
            assert!(checked_mul_div(u128::MAX, 2, 1).is_err());
            assert!(checked_mul_div(MAX_FLOOR.0, MAX_FLOOR.1, MAX_FLOOR.2).is_err());
        }

        #[test]
        fn test_mul_div_does_not_round() {
            assert_eq!(checked_mul_div(3, 7, 10).unwrap(), 2);
            assert_eq!(
                checked_mul_div(u128::MAX, 1, 7).unwrap(),
                48611766702991209066196372490252601636
            );
        }
    }
    mod test_mul_div_round_up {
        use crate::math::checked_mul_div_round_up;

        use super::MAX_FLOOR;

        #[test]
        fn test_mul_div_ok() {
            assert_eq!(checked_mul_div_round_up(0, 4, 4).unwrap(), 0);
            assert_eq!(checked_mul_div_round_up(2, 4, 4).unwrap(), 2);
            assert_eq!(checked_mul_div_round_up(3, 7, 21).unwrap(), 1);
        }

        #[test]
        fn test_mul_div_rounding_up_rounds_up() {
            assert_eq!(checked_mul_div_round_up(3, 7, 10).unwrap(), 3);
            assert_eq!(
                checked_mul_div_round_up(u128::MAX, 1, 7).unwrap(),
                48611766702991209066196372490252601637
            );
            assert_eq!(
                checked_mul_div_round_up(u128::MAX - 1, 1, u128::MAX).unwrap(),
                1
            );
        }

        #[test]
        #[should_panic]
        fn test_mul_div_rounding_upfloor_max_panics() {
            assert_eq!(
                checked_mul_div_round_up(MAX_FLOOR.0, MAX_FLOOR.1, MAX_FLOOR.2).unwrap(),
                u128::MAX
            );
        }

        #[test]
        fn test_mul_div_overflow_panics() {
            assert!(checked_mul_div_round_up(u128::MAX, u128::MAX, 1u128).is_err());
        }
    }

    mod test_div_round_up {
        use crate::math::div_round_up;

        #[test]
        fn test_mul_div_ok() {
            assert_eq!(div_round_up(0, 21).unwrap(), 0);
            assert_eq!(div_round_up(21, 21).unwrap(), 1);
            assert_eq!(div_round_up(8, 4).unwrap(), 2);
        }

        #[test]
        fn test_mul_div_rounding_up_rounds_up() {
            assert_eq!(div_round_up(21, 10).unwrap(), 3);
            assert_eq!(
                div_round_up(u128::MAX, 7).unwrap(),
                48611766702991209066196372490252601637
            );
            assert_eq!(div_round_up(u128::MAX - 1, u128::MAX).unwrap(), 1);
        }
    }

    mod test_mult_shift_right_round_up {
        use crate::math::checked_mul_shift_right_round_up_if;

        #[test]
        fn test_mul_shift_right_ok() {
            assert_eq!(
                checked_mul_shift_right_round_up_if(u64::MAX as u128, 1, false).unwrap(),
                0
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(u64::MAX as u128, 1, true).unwrap(),
                1
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(u64::MAX as u128 + 1, 1, false).unwrap(),
                1
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(u64::MAX as u128 + 1, 1, true).unwrap(),
                1
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(u32::MAX as u128, u32::MAX as u128, false)
                    .unwrap(),
                0
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(u32::MAX as u128, u32::MAX as u128, true)
                    .unwrap(),
                1
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(
                    u32::MAX as u128 + 1,
                    u32::MAX as u128 + 2,
                    false
                )
                .unwrap(),
                1
            );
            assert_eq!(
                checked_mul_shift_right_round_up_if(
                    u32::MAX as u128 + 1,
                    u32::MAX as u128 + 2,
                    true
                )
                .unwrap(),
                2
            );
        }

        #[test]
        fn test_mul_shift_right_u64_max() {
            assert!(checked_mul_shift_right_round_up_if(u128::MAX, 1, true).is_err());
            assert_eq!(
                checked_mul_shift_right_round_up_if(u128::MAX, 1, false).unwrap(),
                u64::MAX
            );
        }
    }
}
