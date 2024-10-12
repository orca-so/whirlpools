use crate::{PositionRatio, PositionStatus, U128};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use super::{order_tick_indexes, tick_index_to_sqrt_price};

/// Check if a position is in range.
/// When a position is in range it is earning fees and rewards
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price of the pool
/// - `tick_lower_index` - A i32 integer representing the lower tick index of the position
/// - `tick_upper_index` - A i32 integer representing the upper tick index of the position
///
/// # Returns
/// - A boolean value indicating if the position is in range
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = isPositionInRange, skip_jsdoc))]
pub fn is_position_in_range(
    sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> bool {
    position_status(sqrt_price.into(), tick_lower_index, tick_upper_index)
        == PositionStatus::PriceInRange
}

/// Calculate the status of a position
/// The status can be one of three values:
/// - InRange: The position is in range
/// - BelowRange: The position is below the range
/// - AboveRange: The position is above the range
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price of the pool
/// - `tick_lower_index` - A i32 integer representing the lower tick index of the position
/// - `tick_upper_index` - A i32 integer representing the upper tick index of the position
///
/// # Returns
/// - A PositionStatus enum value indicating the status of the position
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = positionStatus, skip_jsdoc))]
pub fn position_status(
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> PositionStatus {
    let current_sqrt_price: u128 = current_sqrt_price.into();
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    if tick_lower_index == tick_upper_index {
        PositionStatus::Invalid
    } else if current_sqrt_price <= sqrt_price_lower {
        PositionStatus::PriceBelowRange
    } else if current_sqrt_price >= sqrt_price_upper {
        PositionStatus::PriceAboveRange
    } else {
        PositionStatus::PriceInRange
    }
}

/// Calculate the token_a / token_b ratio of a (ficticious) position
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price of the pool
/// - `tick_lower_index` - A i32 integer representing the lower tick index of the position
/// - `tick_upper_index` - A i32 integer representing the upper tick index of the position
///
/// # Returns
/// - A PositionRatio struct containing the ratio of token_a and token_b
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = positionRatio, skip_jsdoc))]
pub fn position_ratio(
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> PositionRatio {
    let sqrt_price: u128 = current_sqrt_price.into();
    let position_status = position_status(sqrt_price.into(), tick_lower_index, tick_upper_index);
    match position_status {
        PositionStatus::Invalid => PositionRatio {
            ratio_a: 0,
            ratio_b: 0,
        },
        PositionStatus::PriceBelowRange => PositionRatio {
            ratio_a: 10000,
            ratio_b: 0,
        },
        PositionStatus::PriceAboveRange => PositionRatio {
            ratio_a: 0,
            ratio_b: 10000,
        },
        PositionStatus::PriceInRange => {
            let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
            let lower_sqrt_price: u128 =
                tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
            let upper_sqrt_price: u128 =
                tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

            let amount_b: u128 = sqrt_price - lower_sqrt_price;
            let amount_a = upper_sqrt_price - sqrt_price;
            let amount_total = amount_a + amount_b;

            let ratio_a = ((amount_a * 10000) / amount_total) as u16;
            let ratio_b = 10000 - ratio_a;

            PositionRatio { ratio_a, ratio_b }
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
        assert_eq!(
            position_status(18354745142194483560, -100, 100),
            PositionStatus::PriceBelowRange
        );
        assert_eq!(
            position_status(18354745142194483561, -100, 100),
            PositionStatus::PriceBelowRange
        );
        assert_eq!(
            position_status(18354745142194483562, -100, 100),
            PositionStatus::PriceInRange
        );
        assert_eq!(
            position_status(18446744073709551616, -100, 100),
            PositionStatus::PriceInRange
        );
        assert_eq!(
            position_status(18539204128674405811, -100, 100),
            PositionStatus::PriceInRange
        );
        assert_eq!(
            position_status(18539204128674405812, -100, 100),
            PositionStatus::PriceAboveRange
        );
        assert_eq!(
            position_status(18539204128674405813, -100, 100),
            PositionStatus::PriceAboveRange
        );
        assert_eq!(
            position_status(18446744073709551616, 100, 100),
            PositionStatus::Invalid
        );
    }

    #[test]
    fn test_position_ratio() {
        let ratio_1 = position_ratio(18354745142194483560, -100, 100);
        assert_eq!(ratio_1.ratio_a, 10000);
        assert_eq!(ratio_1.ratio_b, 0);

        let ratio_2 = position_ratio(18354745142194483561, -100, 100);
        assert_eq!(ratio_2.ratio_a, 7500);
        assert_eq!(ratio_2.ratio_b, 2500);

        let ratio_3 = position_ratio(18354745142194483562, -100, 100);
        assert_eq!(ratio_3.ratio_a, 5001);
        assert_eq!(ratio_3.ratio_b, 4999);

        let ratio_4 = position_ratio(18446744073709551616, -100, 100);
        assert_eq!(ratio_4.ratio_a, 5000);
        assert_eq!(ratio_4.ratio_b, 5000);

        let ratio_5 = position_ratio(18539204128674405811, -100, 100);
        assert_eq!(ratio_5.ratio_a, 0);
        assert_eq!(ratio_5.ratio_b, 10000);

        let ratio_6 = position_ratio(18539204128674405812, -100, 100);
        assert_eq!(ratio_6.ratio_a, 0);
        assert_eq!(ratio_6.ratio_b, 0);

        let ratio_7 = position_ratio(18539204128674405813, -100, 100);
        assert_eq!(ratio_7.ratio_a, 0);
        assert_eq!(ratio_7.ratio_b, 0);

        let ratio_8 = position_ratio(18446744073709551616, 100, 100);
        assert_eq!(ratio_8.ratio_a, 5000);
        assert_eq!(ratio_8.ratio_b, 5000);
    }
}
