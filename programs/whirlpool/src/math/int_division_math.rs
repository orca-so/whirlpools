pub fn floor_division(dividend: i32, divisor: i32) -> i32 {
    assert!(divisor > 0, "Divisor must be positive.");
    if dividend % divisor == 0 || dividend.signum() == divisor.signum() {
        dividend / divisor
    } else {
        dividend / divisor - 1
    }
}

pub fn ceil_division(dividend: u128, divisor: u128) -> u128 {
    assert!(divisor > 0, "Divisor must be positive.");
    (dividend + divisor - 1) / divisor
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
    fn test_ceil_division() {
        assert_eq!(ceil_division(0, 64), 0);
        assert_eq!(ceil_division(1, 64), 1);
        assert_eq!(ceil_division(63, 64), 1);
        assert_eq!(ceil_division(64, 64), 1);
        assert_eq!(ceil_division(65, 64), 2);
        assert_eq!(ceil_division(127, 64), 2);
        assert_eq!(ceil_division(128, 64), 2);
        assert_eq!(ceil_division(129, 64), 3);
    }
}
