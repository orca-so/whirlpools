use core::ops::{Shl, Shr};

use ethnum::U256;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use crate::{
    adjust_amount, CollectRewardsQuote, PositionFacade, TickFacade, TransferFee, WhirlpoolFacade,
};

/// Calculate rewards owed for a position
///
/// # Paramters
/// - `whirlpool`: The whirlpool state
/// - `position`: The position state
/// - `tick_lower`: The lower tick state
/// - `tick_upper`: The upper tick state
/// - `current_timestamp`: The current timestamp
/// - `transfer_fee_1`: The transfer fee for token 1
/// - `transfer_fee_2`: The transfer fee for token 2
/// - `transfer_fee_3`: The transfer fee for token 3
///
/// # Returns
/// - `CollectRewardsQuote`: The rewards owed for the 3 reward tokens.
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = collectRewardsQuote, skip_jsdoc))]
pub fn collect_rewards_quote(
    whirlpool: WhirlpoolFacade,
    position: PositionFacade,
    tick_lower: TickFacade,
    tick_upper: TickFacade,
    current_timestamp: u64,
    transfer_fee_1: Option<TransferFee>,
    transfer_fee_2: Option<TransferFee>,
    transfer_fee_3: Option<TransferFee>,
) -> CollectRewardsQuote {
    let timestamp_delta = current_timestamp - whirlpool.reward_last_updated_timestamp;

    let mut reward_growth_1: u128 = whirlpool.reward_infos[0].growth_global_x64;
    let mut reward_growth_2: u128 = whirlpool.reward_infos[1].growth_global_x64;
    let mut reward_growth_3: u128 = whirlpool.reward_infos[2].growth_global_x64;

    if whirlpool.liquidity != 0 {
        let reward_growth_delta_1 = whirlpool.reward_infos[0]
            .emissions_per_second_x64
            .saturating_mul(timestamp_delta as u128)
            .saturating_div(whirlpool.liquidity);
        reward_growth_1 += <u128>::try_from(reward_growth_delta_1).unwrap();

        let reward_growth_delta_2 = whirlpool.reward_infos[1]
            .emissions_per_second_x64
            .saturating_mul(timestamp_delta as u128)
            .saturating_div(whirlpool.liquidity);
        reward_growth_2 += <u128>::try_from(reward_growth_delta_2).unwrap();

        let reward_growth_delta_3 = whirlpool.reward_infos[2]
            .emissions_per_second_x64
            .saturating_mul(timestamp_delta as u128)
            .saturating_div(whirlpool.liquidity);
        reward_growth_3 += <u128>::try_from(reward_growth_delta_3).unwrap();
    }

    let mut reward_growth_below_1: u128 = tick_lower.reward_growths_outside[0];
    let mut reward_growth_below_2: u128 = tick_lower.reward_growths_outside[1];
    let mut reward_growth_below_3: u128 = tick_lower.reward_growths_outside[2];

    let mut reward_growth_above_1: u128 = tick_upper.reward_growths_outside[0];
    let mut reward_growth_above_2: u128 = tick_upper.reward_growths_outside[1];
    let mut reward_growth_above_3: u128 = tick_upper.reward_growths_outside[2];

    if whirlpool.tick_current_index < position.tick_lower_index {
        reward_growth_below_1 = reward_growth_1.saturating_sub(reward_growth_below_1);
        reward_growth_below_2 = reward_growth_2.saturating_sub(reward_growth_below_2);
        reward_growth_below_3 = reward_growth_3.saturating_sub(reward_growth_below_3);
    }

    if whirlpool.tick_current_index >= position.tick_upper_index {
        reward_growth_above_1 = reward_growth_1.saturating_sub(reward_growth_above_1);
        reward_growth_above_2 = reward_growth_2.saturating_sub(reward_growth_above_2);
        reward_growth_above_3 = reward_growth_3.saturating_sub(reward_growth_above_3);
    }

    let reward_growth_inside_1 = reward_growth_1
        .saturating_sub(reward_growth_below_1)
        .saturating_sub(reward_growth_above_1);

    let reward_growth_inside_2 = reward_growth_2
        .saturating_sub(reward_growth_below_2)
        .saturating_sub(reward_growth_above_2);

    let reward_growth_inside_3 = reward_growth_3
        .saturating_sub(reward_growth_below_3)
        .saturating_sub(reward_growth_above_3);

    let reward_growth_delta_1: U256 = <U256>::from(reward_growth_inside_1)
        .saturating_sub(position.reward_infos[0].growth_inside_checkpoint.into())
        .saturating_mul(position.liquidity.into())
        .shl(64);

    let reward_growth_delta_2: U256 = <U256>::from(reward_growth_inside_2)
        .saturating_sub(position.reward_infos[1].growth_inside_checkpoint.into())
        .saturating_mul(position.liquidity.into())
        .shl(64);

    let reward_growth_delta_3: U256 = <U256>::from(reward_growth_inside_3)
        .saturating_sub(position.reward_infos[2].growth_inside_checkpoint.into())
        .saturating_mul(position.liquidity.into())
        .shl(64);

    let reward_growth_delta_1: u128 = reward_growth_delta_1.try_into().unwrap();
    let reward_growth_delta_2: u128 = reward_growth_delta_2.try_into().unwrap();
    let reward_growth_delta_3: u128 = reward_growth_delta_3.try_into().unwrap();

    let amount_owed_1: u128 = position.reward_infos[0].amount_owed.into();
    let amount_owed_2: u128 = position.reward_infos[1].amount_owed.into();
    let amount_owed_3: u128 = position.reward_infos[2].amount_owed.into();

    let amount_owed_1_shifted: u128 = amount_owed_1.shl(64);
    let amount_owed_2_shifted: u128 = amount_owed_2.shl(64);
    let amount_owed_3_shifted: u128 = amount_owed_3.shl(64);

    let withdrawable_reward_1: u128 = (amount_owed_1_shifted + reward_growth_delta_1).shr(64);
    let withdrawable_reward_2: u128 = (amount_owed_2_shifted + reward_growth_delta_2).shr(64);
    let withdrawable_reward_3: u128 = (amount_owed_3_shifted + reward_growth_delta_3).shr(64);

    let reward_owed_1 = adjust_amount(withdrawable_reward_1.into(), transfer_fee_1.into(), false);
    let reward_owed_2 = adjust_amount(withdrawable_reward_2.into(), transfer_fee_2.into(), false);
    let reward_owed_3 = adjust_amount(withdrawable_reward_3.into(), transfer_fee_3.into(), false);

    CollectRewardsQuote {
        reward_owed_1: reward_owed_1.into(),
        reward_owed_2: reward_owed_2.into(),
        reward_owed_3: reward_owed_3.into(),
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use crate::{PositionRewardInfoFacade, WhirlpoolRewardInfoFacade};

    use super::*;

    fn test_whirlpool(tick_current_index: i32) -> WhirlpoolFacade {
        WhirlpoolFacade {
            tick_current_index,
            reward_last_updated_timestamp: 0,
            reward_infos: [
                WhirlpoolRewardInfoFacade {
                    growth_global_x64: 500,
                    emissions_per_second_x64: 1,
                },
                WhirlpoolRewardInfoFacade {
                    growth_global_x64: 600,
                    emissions_per_second_x64: 2,
                },
                WhirlpoolRewardInfoFacade {
                    growth_global_x64: 700,
                    emissions_per_second_x64: 3,
                },
            ],
            liquidity: 50,
            ..WhirlpoolFacade::default()
        }
    }

    fn test_position() -> PositionFacade {
        PositionFacade {
            liquidity: 50,
            tick_lower_index: 5,
            tick_upper_index: 10,
            reward_infos: [
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: 100,
                    amount_owed: 100,
                },
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: 200,
                    amount_owed: 200,
                },
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: 300,
                    amount_owed: 300,
                },
            ],
            ..PositionFacade::default()
        }
    }

    fn test_tick() -> TickFacade {
        TickFacade {
            reward_growths_outside: [10, 20, 30],
            ..TickFacade::default()
        }
    }

    #[test]
    fn test_collect_rewards_below_range() {
        let quote = collect_rewards_quote(
            test_whirlpool(0),
            test_position(),
            test_tick(),
            test_tick(),
            10,
            None,
            None,
            None,
        );

        assert_eq!(quote.reward_owed_1, 100);
        assert_eq!(quote.reward_owed_2, 200);
        assert_eq!(quote.reward_owed_3, 300);
    }

    #[test]
    fn test_collect_rewards_in_range() {
        let quote = collect_rewards_quote(
            test_whirlpool(7),
            test_position(),
            test_tick(),
            test_tick(),
            10,
            None,
            None,
            None,
        );

        assert_eq!(quote.reward_owed_1, 19100);
        assert_eq!(quote.reward_owed_2, 18200);
        assert_eq!(quote.reward_owed_3, 17300);
    }

    #[test]
    fn test_collect_rewards_above_range() {
        let quote = collect_rewards_quote(
            test_whirlpool(15),
            test_position(),
            test_tick(),
            test_tick(),
            10,
            None,
            None,
            None,
        );

        assert_eq!(quote.reward_owed_1, 100);
        assert_eq!(quote.reward_owed_2, 200);
        assert_eq!(quote.reward_owed_3, 300);
    }

    #[test]
    fn test_collect_rewards_on_range_lower() {
        let quote = collect_rewards_quote(
            test_whirlpool(5),
            test_position(),
            test_tick(),
            test_tick(),
            10,
            None,
            None,
            None,
        );

        assert_eq!(quote.reward_owed_1, 19100);
        assert_eq!(quote.reward_owed_2, 18200);
        assert_eq!(quote.reward_owed_3, 17300);
    }

    #[test]
    fn test_collect_rewards_on_range_upper() {
        let quote = collect_rewards_quote(
            test_whirlpool(10),
            test_position(),
            test_tick(),
            test_tick(),
            10,
            None,
            None,
            None,
        );

        assert_eq!(quote.reward_owed_1, 100);
        assert_eq!(quote.reward_owed_2, 200);
        assert_eq!(quote.reward_owed_3, 300);
    }

    #[test]
    fn test_transfer_fee() {
        let quote = collect_rewards_quote(
            test_whirlpool(7),
            test_position(),
            test_tick(),
            test_tick(),
            10,
            Some(TransferFee::new(1000)),
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(3000)),
        );

        assert_eq!(quote.reward_owed_1, 17190);
        assert_eq!(quote.reward_owed_2, 14560);
        assert_eq!(quote.reward_owed_3, 12110);
    }
}
