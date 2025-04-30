pub fn floor_division(dividend: i32, divisor: i32) -> i32 {
    assert!(divisor > 0, "Divisor must be positive.");
    if dividend % divisor == 0 || dividend.signum() == divisor.signum() {
        dividend / divisor
    } else {
        dividend / divisor - 1
    }
}

pub fn ceil_division_u128(dividend: u128, divisor: u128) -> u128 {
    assert!(divisor > 0, "Divisor must be positive.");
    let quotient = dividend / divisor;
    let prod = quotient * divisor;
    if prod == dividend {
        quotient
    } else {
        quotient + 1
    }
}

pub fn ceil_division_u32(dividend: u32, divisor: u32) -> u32 {
    assert!(divisor > 0, "Divisor must be positive.");
    let quotient = dividend / divisor;
    let prod = quotient * divisor;
    if prod == dividend {
        quotient
    } else {
        quotient + 1
    }
}

#[cfg(test)]
mod int_div_math_test {
    use super::*;

    #[test]
    fn test_floor_division() {
        assert_eq!(floor_division(0, 64), 0);
        assert_eq!(floor_division(1, 64), 0);
        assert_eq!(floor_division(63, 64), 0);
        assert_eq!(floor_division(64, 64), 1);
        assert_eq!(floor_division(65, 64), 1);
        assert_eq!(floor_division(127, 64), 1);
        assert_eq!(floor_division(128, 64), 2);
        assert_eq!(floor_division(129, 64), 2);
        assert_eq!(floor_division(-1, 64), -1);
        assert_eq!(floor_division(-63, 64), -1);
        assert_eq!(floor_division(-64, 64), -1);
        assert_eq!(floor_division(-65, 64), -2);
        assert_eq!(floor_division(-127, 64), -2);
        assert_eq!(floor_division(-128, 64), -2);
        assert_eq!(floor_division(-129, 64), -3);
    }

    #[test]
    #[should_panic]
    fn test_floor_division_zero_divisor() {
        floor_division(1, 0);
    }

    #[test]
    fn test_ceil_division_u128() {
        assert_eq!(ceil_division_u128(0, 64), 0);
        assert_eq!(ceil_division_u128(1, 64), 1);
        assert_eq!(ceil_division_u128(63, 64), 1);
        assert_eq!(ceil_division_u128(64, 64), 1);
        assert_eq!(ceil_division_u128(65, 64), 2);
        assert_eq!(ceil_division_u128(127, 64), 2);
        assert_eq!(ceil_division_u128(128, 64), 2);
        assert_eq!(ceil_division_u128(129, 64), 3);
        assert_eq!(ceil_division_u128(u128::MAX, 1), u128::MAX);
        assert_eq!(
            ceil_division_u128(u128::MAX, 1000),
            340_282_366_920_938_463_463_374_607_431_768_212u128
        );
    }

    #[test]
    #[should_panic]
    fn test_ceil_division_u128_zero_divisor() {
        ceil_division_u128(1, 0);
    }

    #[test]
    fn test_ceil_division_u32() {
        assert_eq!(ceil_division_u32(0, 64), 0);
        assert_eq!(ceil_division_u32(1, 64), 1);
        assert_eq!(ceil_division_u32(63, 64), 1);
        assert_eq!(ceil_division_u32(64, 64), 1);
        assert_eq!(ceil_division_u32(65, 64), 2);
        assert_eq!(ceil_division_u32(127, 64), 2);
        assert_eq!(ceil_division_u32(128, 64), 2);
        assert_eq!(ceil_division_u32(129, 64), 3);
        assert_eq!(ceil_division_u32(u32::MAX, 1), u32::MAX);
        assert_eq!(ceil_division_u32(u32::MAX, 1000), 4_294_968u32);
    }

    #[test]
    #[should_panic]
    fn test_ceil_division_u32_zero_divisor() {
        ceil_division_u32(1, 0);
    }
}
