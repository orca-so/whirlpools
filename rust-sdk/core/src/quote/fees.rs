use core::ops::Shr;

use ethnum::U256;
#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::{
    try_adjust_amount, CollectFeesQuote, PositionFacade, TickFacade, TransferFee, WhirlpoolFacade,
};

/// Calculate fees owed for a position
///
/// # Paramters
/// - `whirlpool`: The whirlpool state
/// - `position`: The position state
/// - `tick_lower`: The lower tick state
/// - `tick_upper`: The upper tick state
/// - `transfer_fee_a`: The transfer fee for token A
/// - `transfer_fee_b`: The transfer fee for token B
///
/// # Returns
/// - `CollectFeesQuote`: The fees owed for token A and token B
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn collect_fees_quote(
    whirlpool: WhirlpoolFacade,
    position: PositionFacade,
    tick_lower: TickFacade,
    tick_upper: TickFacade,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> CollectFeesQuote {
    let mut fee_growth_below_a: u128 = tick_lower.fee_growth_outside_a;
    let mut fee_growth_above_a: u128 = tick_upper.fee_growth_outside_a;
    let mut fee_growth_below_b: u128 = tick_lower.fee_growth_outside_b;
    let mut fee_growth_above_b: u128 = tick_upper.fee_growth_outside_b;

    if whirlpool.tick_current_index < position.tick_lower_index {
        fee_growth_below_a = whirlpool
            .fee_growth_global_a
            .saturating_sub(fee_growth_below_a);
        fee_growth_below_b = whirlpool
            .fee_growth_global_b
            .saturating_sub(fee_growth_below_b);
    }

    if whirlpool.tick_current_index >= position.tick_upper_index {
        fee_growth_above_a = whirlpool
            .fee_growth_global_a
            .saturating_sub(fee_growth_above_a);
        fee_growth_above_b = whirlpool
            .fee_growth_global_b
            .saturating_sub(fee_growth_above_b);
    }

    let fee_growth_inside_a = whirlpool
        .fee_growth_global_a
        .wrapping_sub(fee_growth_below_a)
        .wrapping_sub(fee_growth_above_a);

    let fee_growth_inside_b = whirlpool
        .fee_growth_global_b
        .wrapping_sub(fee_growth_below_b)
        .wrapping_sub(fee_growth_above_b);

    let fee_owed_delta_a: U256 = <U256>::from(fee_growth_inside_a)
        .wrapping_sub(position.fee_growth_checkpoint_a.into())
        .saturating_mul(position.liquidity.into())
        .shr(64);

    let fee_owed_delta_b: U256 = <U256>::from(fee_growth_inside_b)
        .wrapping_sub(position.fee_growth_checkpoint_b.into())
        .saturating_mul(position.liquidity.into())
        .shr(64);

    let fee_owed_delta_a: u64 = fee_owed_delta_a.try_into().unwrap();
    let fee_owed_delta_b: u64 = fee_owed_delta_b.try_into().unwrap();

    let withdrawable_fee_a = position.fee_owed_a + fee_owed_delta_a;
    let withdrawable_fee_b = position.fee_owed_b + fee_owed_delta_b;

    let fee_owed_a = try_adjust_amount(withdrawable_fee_a, transfer_fee_a.into(), false).unwrap();
    let fee_owed_b = try_adjust_amount(withdrawable_fee_b, transfer_fee_b.into(), false).unwrap();

    CollectFeesQuote {
        fee_owed_a,
        fee_owed_b,
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    fn test_whirlpool(tick_index: i32) -> WhirlpoolFacade {
        WhirlpoolFacade {
            tick_current_index: tick_index,
            fee_growth_global_a: 800,
            fee_growth_global_b: 1000,
            ..WhirlpoolFacade::default()
        }
    }

    fn test_position() -> PositionFacade {
        PositionFacade {
            liquidity: 10000000000000000000,
            tick_lower_index: 5,
            tick_upper_index: 10,
            fee_growth_checkpoint_a: 300,
            fee_owed_a: 400,
            fee_growth_checkpoint_b: 500,
            fee_owed_b: 600,
            ..PositionFacade::default()
        }
    }

    fn test_tick() -> TickFacade {
        TickFacade {
            fee_growth_outside_a: 50,
            fee_growth_outside_b: 20,
            ..TickFacade::default()
        }
    }

    #[test]
    fn test_collect_out_of_range_lower() {
        let result = collect_fees_quote(
            test_whirlpool(0),
            test_position(),
            test_tick(),
            test_tick(),
            None,
            None,
        );
        assert_eq!(result.fee_owed_a, 400);
        assert_eq!(result.fee_owed_b, 600);
    }

    #[test]
    fn test_in_range() {
        let result = collect_fees_quote(
            test_whirlpool(7),
            test_position(),
            test_tick(),
            test_tick(),
            None,
            None,
        );
        assert_eq!(result.fee_owed_a, 616);
        assert_eq!(result.fee_owed_b, 849);
    }

    #[test]
    fn test_collect_out_of_range_upper() {
        let result = collect_fees_quote(
            test_whirlpool(15),
            test_position(),
            test_tick(),
            test_tick(),
            None,
            None,
        );
        assert_eq!(result.fee_owed_a, 400);
        assert_eq!(result.fee_owed_b, 600);
    }

    #[test]
    fn test_collect_on_range_lower() {
        let result = collect_fees_quote(
            test_whirlpool(5),
            test_position(),
            test_tick(),
            test_tick(),
            None,
            None,
        );
        assert_eq!(result.fee_owed_a, 616);
        assert_eq!(result.fee_owed_b, 849);
    }

    #[test]
    fn test_collect_on_upper() {
        let result = collect_fees_quote(
            test_whirlpool(10),
            test_position(),
            test_tick(),
            test_tick(),
            None,
            None,
        );
        assert_eq!(result.fee_owed_a, 400);
        assert_eq!(result.fee_owed_b, 600);
    }

    #[test]
    fn test_collect_transfer_fee() {
        let result = collect_fees_quote(
            test_whirlpool(7),
            test_position(),
            test_tick(),
            test_tick(),
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(5000)),
        );
        assert_eq!(result.fee_owed_a, 492);
        assert_eq!(result.fee_owed_b, 424);
    }
}
