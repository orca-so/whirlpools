use crate::{PositionRatio, PositionStatus};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use super::{order_tick_indexes, tick_index_to_sqrt_price};

/// Check if a position is in range.
/// When a position is in range it is earning fees and rewards
///
/// # Parameters
/// - `tick_current_index` - A i32 integer representing the tick index of the pool
/// - `tick_lower_index` - A i32 integer representing the lower tick index of the position
/// - `tick_upper_index` - A i32 integer representing the upper tick index of the position
///
/// # Returns
/// - A boolean value indicating if the position is in range
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = isPositionInRange, skip_jsdoc))]
pub fn is_position_in_range(
    tick_current_index: i32,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> bool {
    position_status(tick_current_index, tick_lower_index, tick_upper_index)
        == PositionStatus::InRange
}

/// Calculate the status of a position
/// The status can be one of three values:
/// - InRange: The position is in range
/// - BelowRange: The position is below the range
/// - AboveRange: The position is above the range
///
/// # Parameters
/// - `tick_current_index` - A i32 integer representing the tick index of the pool
/// - `tick_lower_index` - A i32 integer representing the lower tick index of the position
/// - `tick_upper_index` - A i32 integer representing the upper tick index of the position
///
/// # Returns
/// - A PositionStatus enum value indicating the status of the position
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = positionStatus, skip_jsdoc))]
pub fn position_status(
    tick_current_index: i32,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> PositionStatus {
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    if tick_range.tick_lower_index == tick_range.tick_upper_index {
        PositionStatus::Invalid
    } else if tick_current_index < tick_range.tick_lower_index {
        PositionStatus::BelowRange
    } else if tick_current_index >= tick_range.tick_upper_index {
        PositionStatus::AboveRange
    } else {
        PositionStatus::InRange
    }
}

/// Calculate the token_a / token_b ratio of a (ficticious) position
///
/// # Parameters
/// - `tick_current_index` - A i32 integer representing the tick index of the pool
/// - `tick_lower_index` - A i32 integer representing the lower tick index of the position
/// - `tick_upper_index` - A i32 integer representing the upper tick index of the position
///
/// # Returns
/// - A PositionRatio struct containing the ratio of token_a and token_b
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = positionRatio, skip_jsdoc))]
pub fn position_ratio(
    tick_current_index: i32,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> PositionRatio {
    let position_status = position_status(tick_current_index, tick_lower_index, tick_upper_index);
    match position_status {
        PositionStatus::Invalid => PositionRatio {
            ratio_a: 0,
            ratio_b: 0,
        },
        PositionStatus::BelowRange => PositionRatio {
            ratio_a: 10000,
            ratio_b: 0,
        },
        PositionStatus::AboveRange => PositionRatio {
            ratio_a: 0,
            ratio_b: 10000,
        },
        PositionStatus::InRange => {
            let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
            let current_sqrt_price: u128 = tick_index_to_sqrt_price(tick_current_index).into();
            let lower_sqrt_price: u128 =
                tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
            let upper_sqrt_price: u128 =
                tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

            let amount_b: u128 = current_sqrt_price - lower_sqrt_price;
            let amount_a = upper_sqrt_price - current_sqrt_price;
            let amount_total = amount_a + amount_b;

            let ratio_a = (amount_a * 10000) / amount_total;
            let ratio_b = 10000 - ratio_a;

            PositionRatio {
                ratio_a: ratio_a.try_into().unwrap(),
                ratio_b: ratio_b.try_into().unwrap(),
            }
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test {
    use super::*;

    #[test]
    fn test_is_position_in_range() {
        assert!(!is_position_in_range(85, 90, 100));
        assert!(is_position_in_range(90, 90, 100));
        assert!(is_position_in_range(95, 90, 100));
        assert!(!is_position_in_range(100, 90, 100));
        assert!(!is_position_in_range(105, 90, 100));
    }

    #[test]
    fn test_position_status() {
        assert_eq!(position_status(85, 90, 100), PositionStatus::BelowRange);
        assert_eq!(position_status(90, 90, 100), PositionStatus::InRange);
        assert_eq!(position_status(95, 90, 100), PositionStatus::InRange);
        assert_eq!(position_status(100, 90, 100), PositionStatus::AboveRange);
        assert_eq!(position_status(105, 90, 100), PositionStatus::AboveRange);
        assert_eq!(position_status(105, 90, 90), PositionStatus::Invalid);
    }

    #[test]
    fn test_position_ratio() {
        let ratio_1 = position_ratio(-10, -10, 10);
        assert_eq!(ratio_1.ratio_a, 10000);
        assert_eq!(ratio_1.ratio_b, 0);

        let ratio_2 = position_ratio(-5, -10, 10);
        assert_eq!(ratio_2.ratio_a, 7500);
        assert_eq!(ratio_2.ratio_b, 2500);

        let ratio_3 = position_ratio(0, -10, 10);
        assert_eq!(ratio_3.ratio_a, 5001);
        assert_eq!(ratio_3.ratio_b, 4999);

        let ratio_4 = position_ratio(5, -10, 10);
        assert_eq!(ratio_4.ratio_a, 2500);
        assert_eq!(ratio_4.ratio_b, 7500);

        let ratio_5 = position_ratio(10, -10, 10);
        assert_eq!(ratio_5.ratio_a, 0);
        assert_eq!(ratio_5.ratio_b, 10000);

        let ratio_6 = position_ratio(10, 10, 10);
        assert_eq!(ratio_6.ratio_a, 0);
        assert_eq!(ratio_6.ratio_b, 0);
    }
}
