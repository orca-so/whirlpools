#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::{
    try_apply_transfer_fee, CollectRewardQuote, CollectRewardsQuote, CoreError, PositionFacade,
    TickFacade, TransferFee, WhirlpoolFacade, ARITHMETIC_OVERFLOW, NUM_REWARDS,
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
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn collect_rewards_quote(
    whirlpool: WhirlpoolFacade,
    position: PositionFacade,
    tick_lower: TickFacade,
    tick_upper: TickFacade,
    current_timestamp: u64,
    transfer_fee_1: Option<TransferFee>,
    transfer_fee_2: Option<TransferFee>,
    transfer_fee_3: Option<TransferFee>,
) -> Result<CollectRewardsQuote, CoreError> {
    let timestamp_delta = current_timestamp - whirlpool.reward_last_updated_timestamp;
    let transfer_fees = [transfer_fee_1, transfer_fee_2, transfer_fee_3];
    let mut reward_quotes: [CollectRewardQuote; NUM_REWARDS] =
        [CollectRewardQuote::default(); NUM_REWARDS];

    for i in 0..NUM_REWARDS {
        let mut reward_growth: u128 = whirlpool.reward_infos[i].growth_global_x64;
        if whirlpool.liquidity != 0 {
            let reward_growth_delta = whirlpool.reward_infos[i]
                .emissions_per_second_x64
                .checked_mul(timestamp_delta as u128)
                .ok_or(ARITHMETIC_OVERFLOW)?
                / whirlpool.liquidity;
            reward_growth += <u128>::try_from(reward_growth_delta).unwrap();
        }

        let mut reward_growth_below = tick_lower.reward_growths_outside[i];
        let mut reward_growth_above = tick_upper.reward_growths_outside[i];

        if whirlpool.tick_current_index < position.tick_lower_index {
            reward_growth_below = reward_growth.wrapping_sub(reward_growth_below);
        }

        if whirlpool.tick_current_index >= position.tick_upper_index {
            reward_growth_above = reward_growth.wrapping_sub(reward_growth_above);
        }

        let reward_growth_inside = reward_growth
            .wrapping_sub(reward_growth_below)
            .wrapping_sub(reward_growth_above);

        let reward_growth_delta =
            reward_growth_inside.wrapping_sub(position.reward_infos[i].growth_inside_checkpoint);

        let reward_owed_delta = if reward_growth_delta == 0 || position.liquidity == 0 {
            0
        } else {
            let product = position
                .liquidity
                .checked_mul(reward_growth_delta)
                .unwrap_or(0);

            (product >> 64) as u64
        };
        let withdrawable_reward = position.reward_infos[i].amount_owed + reward_owed_delta;

        let rewards_owed =
            try_apply_transfer_fee(withdrawable_reward, transfer_fees[i].unwrap_or_default())?;
        reward_quotes[i] = CollectRewardQuote { rewards_owed }
    }

    Ok(CollectRewardsQuote {
        rewards: reward_quotes,
    })
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use crate::{PositionRewardInfoFacade, WhirlpoolRewardInfoFacade};

    use super::*;

    fn test_whirlpool(
        tick_current_index: i32,
        reward_last_updated_timestamp: u64,
        reward_growth_globals: [u128; 3],
        emissions_per_second: [u128; 3],
        liquidity: u128,
    ) -> WhirlpoolFacade {
        WhirlpoolFacade {
            tick_current_index,
            reward_last_updated_timestamp,
            reward_infos: [
                WhirlpoolRewardInfoFacade {
                    growth_global_x64: reward_growth_globals[0],
                    emissions_per_second_x64: emissions_per_second[0],
                },
                WhirlpoolRewardInfoFacade {
                    growth_global_x64: reward_growth_globals[1],
                    emissions_per_second_x64: emissions_per_second[1],
                },
                WhirlpoolRewardInfoFacade {
                    growth_global_x64: reward_growth_globals[2],
                    emissions_per_second_x64: emissions_per_second[2],
                },
            ],
            liquidity,
            ..WhirlpoolFacade::default()
        }
    }

    fn default_test_whirlpool(tick_current_index: i32) -> WhirlpoolFacade {
        test_whirlpool(
            tick_current_index,
            0,
            [500u128 << 64, 600u128 << 64, 700u128 << 64],
            [1, 2, 3],
            50,
        )
    }

    fn test_position(
        liquidity: u128,
        tick_lower_index: i32,
        tick_upper_index: i32,
        growth_inside_checkpoints: [u128; 3],
        amounts_owed: [u64; 3],
    ) -> PositionFacade {
        PositionFacade {
            liquidity,
            tick_lower_index,
            tick_upper_index,
            reward_infos: [
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: growth_inside_checkpoints[0],
                    amount_owed: amounts_owed[0],
                },
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: growth_inside_checkpoints[1],
                    amount_owed: amounts_owed[1],
                },
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: growth_inside_checkpoints[2],
                    amount_owed: amounts_owed[2],
                },
            ],
            ..PositionFacade::default()
        }
    }

    fn default_test_position() -> PositionFacade {
        test_position(50, 5, 10, [0, 0, 0], [100, 200, 300])
    }

    fn test_tick(reward_growths_outside: [u128; 3]) -> TickFacade {
        TickFacade {
            reward_growths_outside,
            ..TickFacade::default()
        }
    }

    fn default_test_tick() -> TickFacade {
        test_tick([10, 20, 30])
    }

    #[test]
    fn test_collect_rewards_below_range() {
        let quote = collect_rewards_quote(
            default_test_whirlpool(0),
            default_test_position(),
            default_test_tick(),
            default_test_tick(),
            10,
            None,
            None,
            None,
        );
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(300));
    }

    #[test]
    fn test_collect_rewards_in_range() {
        let quote = collect_rewards_quote(
            default_test_whirlpool(7),
            default_test_position(),
            default_test_tick(),
            default_test_tick(),
            10,
            None,
            None,
            None,
        );
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(25099));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(30199));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(35299));
    }

    #[test]
    fn test_collect_rewards_above_range() {
        let quote = collect_rewards_quote(
            default_test_whirlpool(15),
            default_test_position(),
            default_test_tick(),
            default_test_tick(),
            10,
            None,
            None,
            None,
        );
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(300));
    }

    #[test]
    fn test_collect_rewards_on_range_lower() {
        let quote = collect_rewards_quote(
            default_test_whirlpool(5),
            default_test_position(),
            default_test_tick(),
            default_test_tick(),
            10,
            None,
            None,
            None,
        );
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(25099));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(30199));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(35299));
    }

    #[test]
    fn test_collect_rewards_on_range_upper() {
        let quote = collect_rewards_quote(
            default_test_whirlpool(10),
            default_test_position(),
            default_test_tick(),
            default_test_tick(),
            10,
            None,
            None,
            None,
        );
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(300));
    }

    #[test]
    fn test_transfer_fee() {
        let quote = collect_rewards_quote(
            default_test_whirlpool(7),
            default_test_position(),
            default_test_tick(),
            default_test_tick(),
            10,
            Some(TransferFee::new(1000)),
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(3000)),
        );
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(22589));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(24159));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(24709));
    }

    #[test]
    fn test_cyclic_growth_checkpoint() {
        let position = test_position(
            91354442895,
            15168,
            19648,
            [
                340282366920938463463374607431768211400,
                340282366920938463463374607431768211000,
                0,
            ],
            [0, 0, 0],
        );

        let whirlpool = test_whirlpool(18158, 0, [0, 0, 0], [0, 0, 0], 0);

        let tick_lower = test_tick([0, 0, 0]);
        let tick_upper = test_tick([0, 0, 0]);

        let result = collect_rewards_quote(
            whirlpool, position, tick_lower, tick_upper, 10, None, None, None,
        )
        .unwrap();
        assert_eq!(result.rewards[0].rewards_owed, 0);
        assert_eq!(result.rewards[1].rewards_owed, 0);
        assert_eq!(result.rewards[2].rewards_owed, 0);
    }

    #[test]
    fn test_force_product_overflow() {
        let whirlpool = test_whirlpool(5, 50, [u128::MAX / 2, 0, 0], [1, 0, 0], 59);

        let position = test_position(u128::MAX, 0, 10, [0, 0, 0], [0, 0, 0]);

        let lower_tick = test_tick([0, 0, 0]);
        let upper_tick = test_tick([0, 0, 0]);

        let result = collect_rewards_quote(
            whirlpool, position, lower_tick, upper_tick, 1746011244, None, None, None,
        )
        .unwrap();

        assert_eq!(result.rewards[0].rewards_owed, 0);
        assert_eq!(result.rewards[1].rewards_owed, 0);
        assert_eq!(result.rewards[2].rewards_owed, 0);
    }
}
