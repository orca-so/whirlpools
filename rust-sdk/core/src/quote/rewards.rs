use ethnum::U256;

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::{
    try_apply_transfer_fee, CollectRewardQuote, CollectRewardsQuote, ErrorCode, PositionFacade,
    TickFacade, TransferFee, WhirlpoolFacade, AMOUNT_EXCEEDS_MAX_U64, ARITHMETIC_OVERFLOW,
    NUM_REWARDS,
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
) -> Result<CollectRewardsQuote, ErrorCode> {
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

        let reward_growth_delta: u64 = <U256>::from(reward_growth_inside)
            .wrapping_sub(position.reward_infos[i].growth_inside_checkpoint.into())
            .checked_mul(position.liquidity.into())
            .ok_or(ARITHMETIC_OVERFLOW)?
            .try_into()
            .map_err(|_| AMOUNT_EXCEEDS_MAX_U64)?;

        let withdrawable_reward = position.reward_infos[i].amount_owed + reward_growth_delta;
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
                    growth_inside_checkpoint: 0,
                    amount_owed: 100,
                },
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: 0,
                    amount_owed: 200,
                },
                PositionRewardInfoFacade {
                    growth_inside_checkpoint: 0,
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
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(300));
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
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(24100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(28200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(32300));
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
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(300));
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
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(24100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(28200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(32300));
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
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(100));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(200));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(300));
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
        assert_eq!(quote.map(|x| x.rewards[0].rewards_owed), Ok(21690));
        assert_eq!(quote.map(|x| x.rewards[1].rewards_owed), Ok(22560));
        assert_eq!(quote.map(|x| x.rewards[2].rewards_owed), Ok(22610));
    }
}
