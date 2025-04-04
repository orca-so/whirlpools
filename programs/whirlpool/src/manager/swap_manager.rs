use solana_program::msg;

use crate::{
    errors::ErrorCode,
    manager::fee_rate_manager::FeeRateManager,
    manager::{
        tick_manager::next_tick_cross_update, whirlpool_manager::next_whirlpool_reward_infos,
    },
    math::*,
    state::*,
    util::SwapTickSequence,
};
use anchor_lang::prelude::*;
use std::convert::TryInto;

#[derive(Debug)]
pub struct PostSwapUpdate {
    pub amount_a: u64,
    pub amount_b: u64,
    pub next_liquidity: u128,
    pub next_tick_index: i32,
    pub next_sqrt_price: u128,
    pub next_fee_growth_global: u128,
    pub next_reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
    pub next_protocol_fee: u64,
    pub next_adaptive_fee_info: Option<AdaptiveFeeInfo>,
}

#[allow(clippy::too_many_arguments)]
pub fn swap(
    whirlpool: &Whirlpool,
    swap_tick_sequence: &mut SwapTickSequence,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    timestamp: u64,
    adaptive_fee_info: &Option<AdaptiveFeeInfo>,
) -> Result<PostSwapUpdate> {
    let adjusted_sqrt_price_limit = if sqrt_price_limit == NO_EXPLICIT_SQRT_PRICE_LIMIT {
        if a_to_b {
            MIN_SQRT_PRICE_X64
        } else {
            MAX_SQRT_PRICE_X64
        }
    } else {
        sqrt_price_limit
    };

    if !(MIN_SQRT_PRICE_X64..=MAX_SQRT_PRICE_X64).contains(&adjusted_sqrt_price_limit) {
        return Err(ErrorCode::SqrtPriceOutOfBounds.into());
    }

    if a_to_b && adjusted_sqrt_price_limit > whirlpool.sqrt_price
        || !a_to_b && adjusted_sqrt_price_limit < whirlpool.sqrt_price
    {
        return Err(ErrorCode::InvalidSqrtPriceLimitDirection.into());
    }

    if amount == 0 {
        return Err(ErrorCode::ZeroTradableAmount.into());
    }

    let tick_spacing = whirlpool.tick_spacing;
    let fee_rate = whirlpool.fee_rate;
    let protocol_fee_rate = whirlpool.protocol_fee_rate;
    let next_reward_infos = next_whirlpool_reward_infos(whirlpool, timestamp)?;

    let mut amount_remaining: u64 = amount;
    let mut amount_calculated: u64 = 0;
    let mut curr_sqrt_price = whirlpool.sqrt_price;
    let mut curr_tick_index = whirlpool.tick_current_index;
    let mut curr_liquidity = whirlpool.liquidity;
    let mut curr_protocol_fee: u64 = 0;
    let mut curr_array_index: usize = 0;
    let mut curr_fee_growth_global_input = if a_to_b {
        whirlpool.fee_growth_global_a
    } else {
        whirlpool.fee_growth_global_b
    };

    let mut fee_rate_manager = FeeRateManager::new(
        a_to_b,
        whirlpool.tick_current_index, // note:  -1 shift is acceptable
        timestamp,
        fee_rate,
        adaptive_fee_info,
    )?;

    while amount_remaining > 0 && adjusted_sqrt_price_limit != curr_sqrt_price {
        let (next_array_index, next_tick_index) = swap_tick_sequence
            .get_next_initialized_tick_index(
                curr_tick_index,
                tick_spacing,
                a_to_b,
                curr_array_index,
            )?;

        let (next_tick_sqrt_price, sqrt_price_target) =
            get_next_sqrt_prices(next_tick_index, adjusted_sqrt_price_limit, a_to_b);

        loop {
            fee_rate_manager.update_volatility_accumulator()?;

            let total_fee_rate = fee_rate_manager.get_total_fee_rate();
            let (bounded_sqrt_price_target, adaptive_fee_update_skipped) =
                fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price_target, curr_liquidity);

            let swap_computation = compute_swap(
                amount_remaining,
                total_fee_rate,
                curr_liquidity,
                curr_sqrt_price,
                bounded_sqrt_price_target,
                amount_specified_is_input,
                a_to_b,
            )?;

            if amount_specified_is_input {
                amount_remaining = amount_remaining
                    .checked_sub(swap_computation.amount_in)
                    .ok_or(ErrorCode::AmountRemainingOverflow)?;
                amount_remaining = amount_remaining
                    .checked_sub(swap_computation.fee_amount)
                    .ok_or(ErrorCode::AmountRemainingOverflow)?;

                amount_calculated = amount_calculated
                    .checked_add(swap_computation.amount_out)
                    .ok_or(ErrorCode::AmountCalcOverflow)?;
            } else {
                amount_remaining = amount_remaining
                    .checked_sub(swap_computation.amount_out)
                    .ok_or(ErrorCode::AmountRemainingOverflow)?;

                amount_calculated = amount_calculated
                    .checked_add(swap_computation.amount_in)
                    .ok_or(ErrorCode::AmountCalcOverflow)?;
                amount_calculated = amount_calculated
                    .checked_add(swap_computation.fee_amount)
                    .ok_or(ErrorCode::AmountCalcOverflow)?;
            }

            let (next_protocol_fee, next_fee_growth_global_input) = calculate_fees(
                swap_computation.fee_amount,
                protocol_fee_rate,
                curr_liquidity,
                curr_protocol_fee,
                curr_fee_growth_global_input,
            );
            curr_protocol_fee = next_protocol_fee;
            curr_fee_growth_global_input = next_fee_growth_global_input;

            if swap_computation.next_price == next_tick_sqrt_price {
                let (next_tick, next_tick_initialized) = swap_tick_sequence
                    .get_tick(next_array_index, next_tick_index, tick_spacing)
                    .map_or_else(|_| (None, false), |tick| (Some(tick), tick.initialized));

                if next_tick_initialized {
                    let (fee_growth_global_a, fee_growth_global_b) = if a_to_b {
                        (curr_fee_growth_global_input, whirlpool.fee_growth_global_b)
                    } else {
                        (whirlpool.fee_growth_global_a, curr_fee_growth_global_input)
                    };

                    let (update, next_liquidity) = calculate_update(
                        next_tick.unwrap(),
                        a_to_b,
                        curr_liquidity,
                        fee_growth_global_a,
                        fee_growth_global_b,
                        &next_reward_infos,
                    )?;

                    curr_liquidity = next_liquidity;
                    swap_tick_sequence.update_tick(
                        next_array_index,
                        next_tick_index,
                        tick_spacing,
                        &update,
                    )?;
                }

                let tick_offset = swap_tick_sequence.get_tick_offset(
                    next_array_index,
                    next_tick_index,
                    tick_spacing,
                )?;

                // Increment to the next tick array if either condition is true:
                //  - Price is moving left and the current tick is the start of the tick array
                //  - Price is moving right and the current tick is the end of the tick array
                curr_array_index = if (a_to_b && tick_offset == 0)
                    || (!a_to_b && tick_offset == TICK_ARRAY_SIZE as isize - 1)
                {
                    next_array_index + 1
                } else {
                    next_array_index
                };

                // The get_init_tick search is inclusive of the current index in an a_to_b trade.
                // We therefore have to shift the index by 1 to advance to the next init tick to the left.
                curr_tick_index = if a_to_b {
                    next_tick_index - 1
                } else {
                    next_tick_index
                };
            } else if swap_computation.next_price != curr_sqrt_price {
                curr_tick_index = tick_index_from_sqrt_price(&swap_computation.next_price);
            }

            curr_sqrt_price = swap_computation.next_price;

            if !adaptive_fee_update_skipped {
                // Note: curr_sqrt_price != bounded_sqrt_price_target implies the end of the loop.
                //       tick_group_index counter exists only in the memory of the FeeRateManager,
                //       so even if it is incremented one extra time at the end of the loop, there is no real harm.
                fee_rate_manager.advance_tick_group();
            } else {
                fee_rate_manager.advance_tick_group_after_skip(
                    curr_sqrt_price,
                    next_tick_sqrt_price,
                    next_tick_index,
                )?;
            }

            // do while loop
            if amount_remaining == 0 || curr_sqrt_price == sqrt_price_target {
                break;
            }
        }
    }

    // Reject partial fills if no explicit sqrt price limit is set and trade is exact out mode
    if amount_remaining > 0
        && !amount_specified_is_input
        && sqrt_price_limit == NO_EXPLICIT_SQRT_PRICE_LIMIT
    {
        return Err(ErrorCode::PartialFillError.into());
    }

    let (amount_a, amount_b) = if a_to_b == amount_specified_is_input {
        (amount - amount_remaining, amount_calculated)
    } else {
        (amount_calculated, amount - amount_remaining)
    };

    let fee_growth = if a_to_b {
        curr_fee_growth_global_input - whirlpool.fee_growth_global_a
    } else {
        curr_fee_growth_global_input - whirlpool.fee_growth_global_b
    };

    // Log delta in fee growth to track pool usage over time with off-chain analytics
    msg!("fee_growth: {}", fee_growth);

    fee_rate_manager.update_major_swap_timestamp(
        timestamp,
        whirlpool.sqrt_price,
        curr_sqrt_price,
    )?;

    Ok(PostSwapUpdate {
        amount_a,
        amount_b,
        next_liquidity: curr_liquidity,
        next_tick_index: curr_tick_index,
        next_sqrt_price: curr_sqrt_price,
        next_fee_growth_global: curr_fee_growth_global_input,
        next_reward_infos,
        next_protocol_fee: curr_protocol_fee,
        next_adaptive_fee_info: fee_rate_manager.get_next_adaptive_fee_info(),
    })
}

fn calculate_fees(
    fee_amount: u64,
    protocol_fee_rate: u16,
    curr_liquidity: u128,
    curr_protocol_fee: u64,
    curr_fee_growth_global_input: u128,
) -> (u64, u128) {
    let mut next_protocol_fee = curr_protocol_fee;
    let mut next_fee_growth_global_input = curr_fee_growth_global_input;
    let mut global_fee = fee_amount;
    if protocol_fee_rate > 0 {
        let delta = calculate_protocol_fee(global_fee, protocol_fee_rate);
        global_fee -= delta;
        next_protocol_fee = next_protocol_fee.wrapping_add(delta);
    }

    if curr_liquidity > 0 {
        next_fee_growth_global_input = next_fee_growth_global_input
            .wrapping_add(((global_fee as u128) << Q64_RESOLUTION) / curr_liquidity);
    }
    (next_protocol_fee, next_fee_growth_global_input)
}

fn calculate_protocol_fee(global_fee: u64, protocol_fee_rate: u16) -> u64 {
    ((global_fee as u128) * (protocol_fee_rate as u128) / PROTOCOL_FEE_RATE_MUL_VALUE)
        .try_into()
        .unwrap()
}

fn calculate_update(
    tick: &Tick,
    a_to_b: bool,
    liquidity: u128,
    fee_growth_global_a: u128,
    fee_growth_global_b: u128,
    reward_infos: &[WhirlpoolRewardInfo; NUM_REWARDS],
) -> Result<(TickUpdate, u128)> {
    // Use updated fee_growth for crossing tick
    // Use -liquidity_net if going left, +liquidity_net going right
    let signed_liquidity_net = if a_to_b {
        -tick.liquidity_net
    } else {
        tick.liquidity_net
    };

    let update =
        next_tick_cross_update(tick, fee_growth_global_a, fee_growth_global_b, reward_infos)?;

    // Update the global liquidity to reflect the new current tick
    let next_liquidity = add_liquidity_delta(liquidity, signed_liquidity_net)?;

    Ok((update, next_liquidity))
}

fn get_next_sqrt_prices(
    next_tick_index: i32,
    sqrt_price_limit: u128,
    a_to_b: bool,
) -> (u128, u128) {
    let next_tick_price = sqrt_price_from_tick_index(next_tick_index);
    let next_sqrt_price_limit = if a_to_b {
        sqrt_price_limit.max(next_tick_price)
    } else {
        sqrt_price_limit.min(next_tick_price)
    };
    (next_tick_price, next_sqrt_price_limit)
}

#[cfg(test)]
mod swap_liquidity_tests {
    use super::*;
    use crate::util::{create_whirlpool_reward_infos, test_utils::swap_test_fixture::*};

    #[test]
    /// A rightward swap on a pool with zero liquidity across the range with initialized ticks.
    /// |____c1___p1________|____p1___________|______________c2|
    ///
    /// Expectation:
    /// The swap will swap 0 assets but the next tick index will end at the end of tick-range.
    fn zero_l_across_tick_range_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 0,
            curr_tick_index: 255, // c1
            start_tick_index: 0,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(1720),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![TestTickInfo {
                // p1
                index: 448,
                liquidity_net: 0,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![TestTickInfo {
                // p1
                index: 720,
                liquidity_net: 0,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: 1720,
                end_liquidity: 0,
                end_reward_growths: [10, 10, 10],
            },
        );
        let tick_lower = tick_sequence.get_tick(0, 448, TS_8).unwrap();
        assert_swap_tick_state(
            tick_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let tick_upper = tick_sequence.get_tick(1, 720, TS_8).unwrap();
        assert_swap_tick_state(
            tick_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A leftward swap on a pool with zero liquidity across the range with initialized ticks.
    /// |____c2___p1________|____p1___________|______________c1|
    ///
    /// Expectation:
    /// The swap will swap 0 assets but the next tick index will end at the end of tick-range.
    fn zero_l_across_tick_range_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 0,
            curr_tick_index: 1720, // c1
            start_tick_index: 1408,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(100),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![],
            array_2_ticks: Some(&vec![TestTickInfo {
                // p1
                index: 720,
                liquidity_net: 0,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![TestTickInfo {
                // p1
                index: 448,
                liquidity_net: 0,
                ..Default::default()
            }]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: 100,
                end_liquidity: 0,
                end_reward_growths: [10, 10, 10],
            },
        );
        let lower_tick = tick_sequence.get_tick(1, 720, TS_8).unwrap();
        assert_swap_tick_state(
            lower_tick,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let lower_tick = tick_sequence.get_tick(2, 448, TS_8).unwrap();
        assert_swap_tick_state(
            lower_tick,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A rightward swap on a pool with zero liquidity at the end of the tick-range.
    /// |_____c1__p1________|_______________|_______________c2|
    ///
    /// Expectation:
    /// The swap will swap some assets up to the last initialized tick and
    /// the next tick index will end at the end of tick-range.
    fn zero_l_after_first_tick_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 100_000,
            curr_tick_index: 255, // c1
            start_tick_index: 0,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(1720),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![TestTickInfo {
                // p1
                index: 448,
                liquidity_net: -100_000,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![]),
            array_3_ticks: Some(&vec![]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 948,
                traded_amount_b: 983,
                end_tick_index: 1720,
                end_liquidity: 0,
                end_reward_growths: [10, 10, 10],
            },
        );
        let tick = tick_sequence.get_tick(0, 448, TS_8).unwrap();
        assert_swap_tick_state(
            tick,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A leftward swap on a pool with zero liquidity at the end of the tick-range.
    /// |c2_______p1________|_______________|_____c1_________|
    ///
    /// Expectation:
    /// The swap will swap some assets up to the last initialized tick and
    /// the next tick index will end at the end of tick-range.
    fn zero_l_after_first_tick_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 100_000,
            curr_tick_index: 1720, // c1
            start_tick_index: 1408,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(0),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![],
            array_2_ticks: Some(&vec![]),
            array_3_ticks: Some(&vec![TestTickInfo {
                // p1
                index: 448,
                liquidity_net: 100_000,
                ..Default::default()
            }]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 6026,
                traded_amount_b: 6715,
                end_tick_index: -1, // -1 a-to-b decrements by one when target price reached
                end_liquidity: 0,
                end_reward_growths: [10, 10, 10],
            },
        );
        let tick = tick_sequence.get_tick(2, 448, TS_8).unwrap();
        assert_swap_tick_state(
            tick,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A rightward swap that traverses an empty gap with no liquidity.
    /// |_______p1____c1___|____p1_______p2__|___c2__p2________|
    ///
    /// Expectation:
    /// The swap will swap some assets up to the end of p1, jump through the gap
    /// and continue swapping assets in p2 until the expected trade amount is satisfied.
    fn zero_l_between_init_ticks_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 100_000,
            curr_tick_index: 500, // c1
            start_tick_index: 0,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(1430),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![TestTickInfo {
                // p1
                index: 448,
                liquidity_net: 100_000,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![
                TestTickInfo {
                    // p1
                    index: 768,
                    liquidity_net: -100_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 1120,
                    liquidity_net: 100_000,
                    ..Default::default()
                },
            ]),
            array_3_ticks: Some(&vec![TestTickInfo {
                // p2
                index: 1536,
                liquidity_net: -100_000,
                ..Default::default()
            }]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 2752,
                traded_amount_b: 3036,
                end_tick_index: 1430,
                end_liquidity: 100000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(0, 448, TS_8).unwrap();
        let p1_upper = tick_sequence.get_tick(1, 768, TS_8).unwrap();
        assert_swap_tick_state(p1_lower, &TickExpectation::default());
        assert_swap_tick_state(
            p1_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let p2_lower = tick_sequence.get_tick(1, 1120, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(2, 1536, TS_8).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(p2_upper, &TickExpectation::default());
    }

    #[test]
    /// A leftward swap that traverses an empty gap with no liquidity.
    /// |_______p1____c2___|____p1_______p2__|___c1__p2________|
    ///
    /// Expectation:
    /// The swap will swap some assets up to the end of p2, jump through the gap
    /// and continue swapping assets in p1 until the expected trade amount is satisfied.
    fn zero_l_between_init_ticks_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 100_000,
            curr_tick_index: 1440, // c1
            start_tick_index: 1408,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(500),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![TestTickInfo {
                // p2
                index: 1448,
                liquidity_net: -100_000,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![
                TestTickInfo {
                    // p1
                    index: 720,
                    liquidity_net: -100_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 1120,
                    liquidity_net: 100_000,
                    ..Default::default()
                },
            ]),
            array_3_ticks: Some(&vec![TestTickInfo {
                // p1
                index: 448,
                liquidity_net: 100_000,
                ..Default::default()
            }]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 2568,
                traded_amount_b: 2839,
                end_tick_index: 500,
                end_liquidity: 100000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(2, 448, TS_8).unwrap();
        let p1_upper = tick_sequence.get_tick(1, 720, TS_8).unwrap();
        assert_swap_tick_state(p1_lower, &TickExpectation::default());
        assert_swap_tick_state(
            p1_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let p2_lower = tick_sequence.get_tick(1, 1120, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 1448, TS_8).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(p2_upper, &TickExpectation::default());
    }

    #[test]
    /// A swap that moves the price to the right to another initialized
    /// tick within the same array.
    /// |_c1__p1___p2____p2__c2__p1__|
    ///
    /// Expectation:
    /// The swap will traverse through all initialized ticks (some of p1, p2) and
    /// exit until the expected trade amount is satisfied.
    fn next_initialized_tick_in_same_array_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 100_000,
            curr_tick_index: 5, // c1
            start_tick_index: 0,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(400),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: 8,
                    liquidity_net: 100_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 128,
                    liquidity_net: 200_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 320,
                    liquidity_net: -200_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 448,
                    liquidity_net: -100_000,
                    ..Default::default()
                },
            ],
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence =
            SwapTickSequence::new(swap_test_info.tick_arrays[0].borrow_mut(), None, None);
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 5791,
                traded_amount_b: 5920,
                end_tick_index: 400,
                end_liquidity: 200000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(0, 8, TS_8).unwrap();
        let p1_upper = tick_sequence.get_tick(0, 448, TS_8).unwrap();
        assert_swap_tick_state(
            p1_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(0, 128, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 320, TS_8).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p2_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves the price to the left to another initialized
    /// tick within the same array.
    /// |_c2__p1___p2____p2__p1__c1_|
    ///
    /// Expectation:
    /// The swap will traverse through all initialized ticks (some of p1, p2) and
    /// exit until the expected trade amount is satisfied.
    fn next_initialized_tick_in_same_array_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 100_000,
            curr_tick_index: 568, // c1
            start_tick_index: 0,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(5),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: 8,
                    liquidity_net: 100_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 128,
                    liquidity_net: 200_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 320,
                    liquidity_net: -200_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 448,
                    liquidity_net: -100_000,
                    ..Default::default()
                },
            ],
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence =
            SwapTickSequence::new(swap_test_info.tick_arrays[0].borrow_mut(), None, None);
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 6850,
                traded_amount_b: 7021,
                end_tick_index: 5,
                end_liquidity: 100000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(0, 8, TS_8).unwrap();
        let p1_upper = tick_sequence.get_tick(0, 448, TS_8).unwrap();
        assert_swap_tick_state(
            p1_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p1_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let p2_lower = tick_sequence.get_tick(0, 128, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 320, TS_8).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p2_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves the price to the right from 1 tick-array to the next tick-array.
    /// |____p1____c1____p2__|__p2__c2____p1______|
    ///
    /// Expectation:
    /// The swap loop will traverse across the two tick-arrays on each initialized-tick and
    /// at the end of the first tick-array. It will complete the swap and the next tick index
    /// is in tick-array 2.
    fn next_initialized_tick_in_next_array_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 11_000_000,
            curr_tick_index: 25000, // c1
            start_tick_index: 22528,
            trade_amount: 11_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(37000),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: 23168,
                    liquidity_net: 5_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 28416,
                    liquidity_net: 6_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: Some(&vec![
                TestTickInfo {
                    // p2
                    index: 33920,
                    liquidity_net: -6_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 37504,
                    liquidity_net: -5_000_000,
                    ..Default::default()
                },
            ]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            None,
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 1770620,
                traded_amount_b: 39429146,
                end_tick_index: 37000,
                end_liquidity: 11000000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(0, 23168, TS_128).unwrap();
        let p1_upper = tick_sequence.get_tick(1, 37504, TS_128).unwrap();
        assert_swap_tick_state(p1_lower, &TickExpectation::default());
        assert_swap_tick_state(p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(0, 28416, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(1, 33920, TS_128).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p2_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves the price to the left from 1 tick-array to the next tick-array.
    /// |____p1____c2____p2__|__p2__c1____p1______|
    ///
    /// Expectation:
    /// The swap loop will traverse across the two tick-arrays on each initialized-tick and
    /// at the end of tick-array 2. It will complete the swap and the next tick index
    /// is in tick-array 1.
    fn next_initialized_tick_in_next_array_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 11_000_000,
            curr_tick_index: 37000, // c1
            start_tick_index: 29824,
            trade_amount: 110_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(25000),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p2
                    index: 30720,
                    liquidity_net: -6_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 37504,
                    liquidity_net: -5_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: Some(&vec![
                TestTickInfo {
                    // p1
                    index: 23168,
                    liquidity_net: 5_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 28416,
                    liquidity_net: 6_000_000,
                    ..Default::default()
                },
            ]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            None,
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 1579669,
                traded_amount_b: 34593019,
                end_tick_index: 25000,
                end_liquidity: 11000000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(1, 23168, TS_128).unwrap();
        let p1_upper = tick_sequence.get_tick(0, 37504, TS_128).unwrap();
        assert_swap_tick_state(p1_lower, &TickExpectation::default());
        assert_swap_tick_state(p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(1, 28416, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 30720, TS_128).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p2_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves the price to the right, jumping a tick-array with 0
    /// initialized tick in between.
    /// |____p1____c1____p2__|_________________|__p2___c2__p1______|
    ///
    /// Expectation:
    /// The swap loop will traverse across the tick-range on each initialized-tick and
    /// at the end of all traversed tick-arrays. It will complete the swap and the next tick index
    /// is in tick-array 3.
    fn next_initialized_tick_not_in_adjacent_array_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 11_000_000,
            curr_tick_index: 30080, // c1
            start_tick_index: 29824,
            trade_amount: 10_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(57000),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: 29952,
                    liquidity_net: 5_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 30336,
                    liquidity_net: 6_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: Some(&vec![]), // 41,088
            array_3_ticks: Some(&vec![
                // 52,352
                TestTickInfo {
                    // p2
                    index: 56192,
                    liquidity_net: -6_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 57216,
                    liquidity_net: -5_000_000,
                    ..Default::default()
                },
            ]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 2763589,
                traded_amount_b: 212908090,
                end_tick_index: 57000,
                end_liquidity: 11000000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(0, 29952, TS_128).unwrap();
        let p1_upper = tick_sequence.get_tick(2, 57216, TS_128).unwrap();
        assert_swap_tick_state(p1_lower, &TickExpectation::default());
        assert_swap_tick_state(p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(0, 30336, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(2, 56192, TS_128).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p2_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves the price to the left, jumping a tick-array with 0
    /// initialized tick in between.
    /// |____p1____c2____p2__|_________________|__p2___c1__p1______|
    ///
    /// Expectation:
    /// The swap loop will traverse across the tick-range on each initialized-tick and
    /// at the end of all traversed tick-arrays. It will complete the swap and the next tick index
    /// is in tick-array 1.
    fn next_initialized_tick_not_in_adjacent_array_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 11_000_000,
            curr_tick_index: 48896, // c1
            start_tick_index: 48256,
            trade_amount: 117_900_000,
            sqrt_price_limit: sqrt_price_from_tick_index(0),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p2
                    index: 48512,
                    liquidity_net: -6_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 49280,
                    liquidity_net: -5_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: Some(&vec![]),
            array_3_ticks: Some(&vec![
                TestTickInfo {
                    // p1
                    index: 29952,
                    liquidity_net: 5_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 30336,
                    liquidity_net: 6_000_000,
                    ..Default::default()
                },
            ]),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 2281190,
                traded_amount_b: 117900000,
                end_tick_index: 30041,
                end_liquidity: 11000000,
                end_reward_growths: [10, 10, 10],
            },
        );
        let p1_lower = tick_sequence.get_tick(2, 29952, TS_128).unwrap();
        let p1_upper = tick_sequence.get_tick(0, 49280, TS_128).unwrap();
        assert_swap_tick_state(p1_lower, &TickExpectation::default());
        assert_swap_tick_state(p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(2, 30336, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 48512, TS_128).unwrap();
        assert_swap_tick_state(
            p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            p2_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves across towards the right on all tick-arrays
    /// with no initialized-ticks in the tick-range, but has the liquidity to support it
    /// as long as sqrt_price or amount stops in the tick-range.
    /// |c1_____________|_________________|________________c2|...limit
    ///
    /// Expectation:
    /// The swap loop will traverse across the tick-range on the last index of each tick-array.
    /// It will complete the swap at the end of the tick-range.
    fn no_initialized_tick_range_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500_000,
            curr_tick_index: -322176, // c1
            start_tick_index: -322176,
            trade_amount: 1_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(0),
            amount_specified_is_input: false,
            a_to_b: false,
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 1_000_000_000_000,
                traded_amount_b: 1,
                end_tick_index: -317663,
                end_liquidity: 500000,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves across towards the right on all tick-arrays
    /// with no initialized-ticks in the tick-range, but has the liquidity to support it.
    /// |c1_____________|_________________|_________________|...limit
    ///
    /// Expectation:
    /// The swap loop will fail if the sqrt_price exceeds the last tick of the last array
    #[should_panic(expected = "TickArraySequenceInvalidIndex")]
    fn sqrt_price_exceeds_tick_range_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500_000,
            curr_tick_index: -322176, // c1
            start_tick_index: -322176,
            trade_amount: 100_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(0),
            amount_specified_is_input: false,
            a_to_b: false,
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 1_000_000_000_000,
                traded_amount_b: 1,
                end_tick_index: -317663,
                end_liquidity: 500000,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves across towards the left on all tick-arrays
    /// with no initialized-ticks in the tick-range, but has the liquidity to support it,
    /// as long as sqrt_price or amount stops in the tick-range.
    /// |limit, c2____________|_________________|____c1__________|
    /// -326656            -315,392         -304,128        -292,864
    ///
    /// Expectation:
    /// The swap loop will traverse across the tick-range on the last index of each tick-array.
    /// It will complete the swap at the start of the tick-range.
    ///
    fn no_initialized_tick_range_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 11_000_000,
            curr_tick_index: -302080, // c1
            start_tick_index: -304128,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-326656),
            amount_specified_is_input: false,
            a_to_b: true,
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 96362985379416,
                traded_amount_b: 2,
                end_tick_index: -326657, // -1 because swap crossed 340608 and is an initialized tick
                end_liquidity: 11000000,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    /// A swap that moves across towards past the left on all tick-arrays
    /// with no initialized-ticks in the tick-range, but has the liquidity to support it.
    /// limit |____________|_________________|____c1__________|
    ///         -326656    -315,392         -304,128        -292,864
    ///
    /// Expectation:
    /// The swap loop will fail if the sqrt_price exceeds the last tick of the last array
    #[should_panic(expected = "TickArraySequenceInvalidIndex")]
    fn sqrt_price_exceeds_tick_range_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 11_000_000,
            curr_tick_index: -302080, // c1
            start_tick_index: -304128,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-326657),
            amount_specified_is_input: false,
            a_to_b: true,
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 96362985379416,
                traded_amount_b: 2,
                end_tick_index: -326657, // -1 because swap crossed 340608 and is an initialized tick
                end_liquidity: 11000000,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    #[should_panic(expected = "MultiplicationShiftRightOverflow")]
    /// A swap in a pool with maximum liquidity that reaches the maximum tick
    /// |__p1_____c1______p1_c2|max
    ///
    /// Expectation:
    /// The swap will error on `TokenMaxExceeded` as it is not possible to increment more than the maximum token allowed.
    fn max_l_at_max_tick_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: u64::MAX as u128,
            curr_tick_index: 442500, // c1
            start_tick_index: 442368,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(443636),
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: 442496,
                    liquidity_net: 500_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: 443520,
                    liquidity_net: -500_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: None,
            array_3_ticks: None,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let _post_swap = swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// A swap in a pool that reaches the minimum tick
    /// l = 0
    /// min|c2_p1_____c1___p1|
    ///
    /// Expectation:
    /// The swap will not trade anything and end of the min-tick-index.
    fn min_l_at_min_sqrt_price_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500_000_000,
            curr_tick_index: -442500, // c1
            start_tick_index: -451584,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-443636),
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: -442496,
                    liquidity_net: -500_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: -443520,
                    liquidity_net: 500_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: None,
            array_3_ticks: None,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 106151097514387301,
                traded_amount_b: 0,
                end_tick_index: -443637,
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// The swap crosses the last tick of a tick array and then continues
    /// into the next tick array.
    ///
    /// |__________c1|t1|________c2____|_____________|
    /// -33792         -22528        -11264
    fn traversal_from_last_tick_in_array_to_next_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 7587362620357,
            curr_tick_index: -22657, // c1
            start_tick_index: -33792,
            trade_amount: 10_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-22300),
            amount_specified_is_input: true,
            a_to_b: false,
            array_1_ticks: &vec![TestTickInfo {
                // p1
                index: -22656,
                liquidity_net: 100,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![TestTickInfo {
                // p1
                index: -22400,
                liquidity_net: -100,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);

        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 95975095232,
                traded_amount_b: 10000000000,
                end_tick_index: -22576,
                end_liquidity: 7587362620457,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    /// The swap crosses the first tick of the tick array and then continues
    /// into the next tick array.
    ///
    /// |__________|________c2____|t1|c1___________|
    /// -33792      -22528         -11264
    fn traversal_from_last_tick_in_array_to_next_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 7587362620357,
            curr_tick_index: -11135, // c1
            start_tick_index: -11264,
            trade_amount: 100_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-22300),
            amount_specified_is_input: true,
            a_to_b: true,
            array_1_ticks: &vec![TestTickInfo {
                // p1
                index: -11264,
                liquidity_net: 100,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![TestTickInfo {
                // p1
                index: -22400,
                liquidity_net: -100,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 9897370858896,
                traded_amount_b: 1860048818693,
                end_tick_index: -22300,
                end_liquidity: 7587362620257,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    ///
    /// |_______c1___t1|__________t2|__________t3,c2|
    /// -33792         -22528        -11264
    fn traversal_to_last_tick_in_next_array_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 7587362620357,
            curr_tick_index: -22784, // c1
            start_tick_index: -33792,
            trade_amount: 10_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-2),
            amount_specified_is_input: true,
            a_to_b: false,
            array_1_ticks: &vec![TestTickInfo {
                index: -22784,
                liquidity_net: 100,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![TestTickInfo {
                index: -11392,
                liquidity_net: 100,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![TestTickInfo {
                index: -256,
                liquidity_net: -100,
                ..Default::default()
            }]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);

        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 16115482403568,
                traded_amount_b: 5157940702072,
                end_tick_index: -2,
                end_liquidity: 7587362620357,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    ///
    /// |_______c1___t1|__________t2|__________t3,c2|
    /// -33792         -22528        -11264
    fn traversal_to_last_tick_in_last_array_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 7587362620357,
            curr_tick_index: -22784, // c1
            start_tick_index: -33792,
            trade_amount: 10_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-128),
            amount_specified_is_input: true,
            a_to_b: false,
            array_1_ticks: &vec![TestTickInfo {
                index: -22784,
                liquidity_net: 100,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![TestTickInfo {
                index: -11392,
                liquidity_net: 100,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![TestTickInfo {
                index: -128,
                liquidity_net: -100,
                ..Default::default()
            }]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);

        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 16067528741228,
                traded_amount_b: 5110297712223,
                end_tick_index: -128,
                end_liquidity: 7587362620357,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    ///
    /// |t1c1__________|t2___________|_________t1c1|
    /// -33792          -22528        -11264
    fn traversal_to_last_tick_in_next_array_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 7587362620357,
            curr_tick_index: -256, // c1
            start_tick_index: -11264,
            trade_amount: 100_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-33791),
            amount_specified_is_input: true,
            a_to_b: true,
            array_1_ticks: &vec![TestTickInfo {
                index: -256,
                liquidity_net: -100,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![TestTickInfo {
                index: -22528,
                liquidity_net: 100,
                ..Default::default()
            }]),
            array_3_ticks: Some(&vec![TestTickInfo {
                index: -33792,
                liquidity_net: 100,
                ..Default::default()
            }]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);

        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 33412493784228,
                traded_amount_b: 6090103077425,
                end_tick_index: -33791,
                end_liquidity: 7587362620357,
                end_reward_growths: [10, 10, 10],
            },
        );
    }

    #[test]
    ///
    /// |t1c1__________|t2___________|_________t1c1|
    /// -33792          -22528        -11264
    fn traversal_to_last_tick_in_last_array_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 7587362620357,
            curr_tick_index: -256, // c1
            start_tick_index: -11264,
            trade_amount: 100_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-33792),
            amount_specified_is_input: true,
            a_to_b: true,
            array_1_ticks: &vec![TestTickInfo {
                index: -256,
                liquidity_net: -100,
                ..Default::default()
            }],
            array_2_ticks: Some(&vec![]),
            array_3_ticks: Some(&vec![TestTickInfo {
                index: -33792,
                liquidity_net: 100,
                ..Default::default()
            }]),
            reward_infos: create_whirlpool_reward_infos(100, 10),
            fee_growth_global_a: 100,
            fee_growth_global_b: 100,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);

        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 33414548612789,
                traded_amount_b: 6090173110437,
                end_tick_index: -33793,
                end_liquidity: 7587362620357,
                end_reward_growths: [10, 10, 10],
            },
        );
    }
}

#[cfg(test)]
mod swap_sqrt_price_tests {
    use super::*;
    use crate::util::test_utils::swap_test_fixture::*;

    #[test]
    #[should_panic(expected = "SqrtPriceOutOfBounds")]
    /// A swap with the price limit over the max price limit.
    /// |__p1_____p1_____c1___max|...limit|
    ///
    /// Expectation:
    /// Fail on out of bounds sqrt-price-limit.
    fn sqrt_price_limit_over_max_tick() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500,
            curr_tick_index: 442500, // c1
            start_tick_index: 442368,
            trade_amount: 100_000_000_000_000_000,
            sqrt_price_limit: MAX_SQRT_PRICE_X64 + 1,
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// An attempt to swap to the maximum tick without the last initializable tick
    /// being initialized
    /// |__p1_____p1_____c1___c2,max,limit|
    ///
    /// Expectation:
    /// Successfully swap to the maximum tick / maximum sqrt-price
    fn sqrt_price_limit_at_max_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 10,
            curr_tick_index: 443635, // c1
            start_tick_index: 442368,
            trade_amount: 100_000_000_000_000_000,
            sqrt_price_limit: MAX_SQRT_PRICE_X64,
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 2147283,
                end_tick_index: 443636,
                end_liquidity: 10,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// A rightward swap that is limited by the max price limit.
    /// |____p1______c1______p1_c2,max,limit|
    ///
    /// Expectation:
    /// The swap will complete at the maximum tick index
    fn sqrt_price_limit_at_max_with_last_init_tick_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500,
            curr_tick_index: 442500, // c1
            start_tick_index: 442368,
            trade_amount: 100_000_000_000_000_000,
            sqrt_price_limit: MAX_SQRT_PRICE_X64, // c2, limit
            amount_specified_is_input: false,
            a_to_b: false,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: 442496,
                    liquidity_net: 500,
                    ..Default::default()
                },
                TestTickInfo {
                    // p2
                    index: 443520,
                    liquidity_net: -500,
                    ..Default::default()
                },
            ],
            array_2_ticks: None,
            array_3_ticks: None,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 106151097576,
                end_tick_index: 443636,
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    #[should_panic(expected = "SqrtPriceOutOfBounds")]
    /// A swap with the price limit under the min price limit.
    /// |limit...|min____c2____c1____|
    ///
    /// Expectation:
    /// Fail on out of bounds sqrt-price-limit.
    fn sqrt_price_limit_under_min_tick() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500,
            curr_tick_index: -443500, // c1
            start_tick_index: -451584,
            trade_amount: 100_000_000_000_000_000,
            sqrt_price_limit: MIN_SQRT_PRICE_X64 - 1,
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![],
            array_2_ticks: None,
            array_3_ticks: None,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// A leftward swap into the min price with the price limit set at min price.
    /// |limit,min,p1,c2______c1______|
    ///
    /// Expectation:
    /// The swap will succeed and exits at the minimum tick index
    fn sqrt_price_limit_at_min_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 50_000_000,
            curr_tick_index: -442620, // c1
            start_tick_index: -451584,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-443636), // c2, limit
            amount_specified_is_input: false,
            a_to_b: true,
            array_1_ticks: &vec![
                TestTickInfo {
                    // p1
                    index: -442624,
                    liquidity_net: -500_000_000,
                    ..Default::default()
                },
                TestTickInfo {
                    // p1
                    index: -443520,
                    liquidity_net: 550_000_000,
                    ..Default::default()
                },
            ],
            array_2_ticks: None,
            array_3_ticks: None,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 102927825595253698,
                traded_amount_b: 0,
                end_tick_index: -443637,
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// A leftward swap with the sqrt-price limit lower than the swap-target.
    /// |______limit____c2_____c1_|
    ///
    /// Expectation:
    /// The swap will succeed and exits when expected trade amount is swapped.
    fn sqrt_price_limit_under_current_tick_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: -225365, // c1
            start_tick_index: -225792,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(-226000), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 613293650976,
                traded_amount_b: 100,
                end_tick_index: -225397,
                end_liquidity: 5_000_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// A leftward swap with the sqrt-price limit higher than the swap target.
    /// |______c2____limit______c1_|
    ///
    /// Expectation:
    /// Swap will be stopped at the sqrt-price-limit
    fn sqrt_price_limit_under_current_tick_stop_limit_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: -225365, // c1
            start_tick_index: -225792,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(-225380), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 293539494127,
                traded_amount_b: 47,
                end_tick_index: -225380,
                end_liquidity: 5_000_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    #[should_panic(expected = "InvalidSqrtPriceLimitDirection")]
    /// A rightward swap with the sqrt-price below the current tick index.
    /// |______limit____c1_____c2_|
    ///
    /// Expectation:
    /// Swap will fail because the sqrt-price limit is in the opposite direction.
    fn sqrt_price_limit_under_current_tick_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: -225365, // c1
            start_tick_index: -225792,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(-225790), // limit
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// A leftward swap with the sqrt-price limit at the current tick index.
    /// |__c2____limit,c1_______|
    ///
    /// Expectation:
    /// Swap will not swap and exit on the price limit since it cannot proceed into the price limit.
    fn sqrt_price_limit_at_current_tick_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: -225365, // c1
            start_tick_index: -225792,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(-225365), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: -225365,
                end_liquidity: 5_000_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// A rightward swap with the sqrt-price limit at the current tick index.
    /// |____c1,limit__c2__|
    ///
    /// Expectation:
    /// Swap will not swap and exit on the price limit since it cannot proceed into the price limit.
    fn sqrt_price_limit_at_current_tick_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: -225365, // c1
            start_tick_index: -225792,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(-225365), // limit
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: -225365,
                end_liquidity: 5_000_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    #[should_panic(expected = "InvalidSqrtPriceLimitDirection")]
    /// A leftward swap with the sqrt-price limit higher than the current tick index.
    /// |____c2___c1___limit__|
    ///
    /// Expectation:
    /// Swap will fail because price limit is in the wrong direction.
    fn sqrt_price_limit_over_current_tick_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000,
            curr_tick_index: 64900, // c1
            start_tick_index: 64512,
            trade_amount: 100_000,
            sqrt_price_limit: sqrt_price_from_tick_index(65000), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// A rightward swap with the sqrt-price limit higher than the current tick index.
    /// |__c1_____c2___limit__|
    ///
    /// Expectataion:
    /// The swap will succeed and exits when expected trade amount is swapped.
    fn sqrt_price_limit_over_current_tick_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000,
            curr_tick_index: 64900, // c1
            start_tick_index: 64512,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(65388), // limit
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 100,
                traded_amount_b: 65865,
                end_tick_index: 64910,
                end_liquidity: 5_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// A rightward swap with the sqrt-price limit lower than the next tick index.
    /// |____c1____limit__c2__|
    ///
    /// Expectataion:
    /// The swap will succeed and exits at the sqrt-price limit.
    fn sqrt_price_limit_over_current_tick_stop_limit_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000,
            curr_tick_index: 64900, // c1
            start_tick_index: 64512,
            trade_amount: 100,
            sqrt_price_limit: sqrt_price_from_tick_index(64905), // limit
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 48,
                traded_amount_b: 32075,
                end_tick_index: 64905,
                end_liquidity: 5_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    #[should_panic(expected = "TickArraySequenceInvalidIndex")]
    /// An attempt to swap walking over 3 tick arrays
    /// |c1_____|_______|_______|c2 limit(0)
    ///
    /// Expectation:
    /// Swap will fail due to over run
    fn sqrt_price_limit_0_b_to_a_map_to_max() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: 1, // c1
            start_tick_index: 0,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: 0, // no explicit limit = over run = TickArraySequenceInvalidIndex
            amount_specified_is_input: false, // exact out
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    #[should_panic(expected = "TickArraySequenceInvalidIndex")]
    /// An attempt to swap walking over 3 tick arrays
    /// limit(0) c2|_______|_______|_____c1|
    ///
    /// Expectation:
    /// Swap will fail due to over run
    fn sqrt_price_limit_0_a_to_b_map_to_min() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: 256,
            start_tick_index: 0,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: 0, // no explicit limit = over run = TickArraySequenceInvalidIndex
            amount_specified_is_input: false, // exact out
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    #[should_panic(expected = "PartialFillError")]
    /// An attempt to swap to the maximum tick implicitly without the last initializable tick
    /// being initialized
    /// |c1_______________c2,max,limit(0)|
    ///
    /// Expectation:
    /// Swap will fail due to partial fill.
    fn sqrt_price_limit_0_b_to_a_exact_out() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: 442369, // c1
            start_tick_index: 442368,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: 0,              // no explicit limit
            amount_specified_is_input: false, // exact out
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    #[should_panic(expected = "PartialFillError")]
    /// An attempt to swap to the minimum tick implicitly without the last initializable tick
    /// being initialized
    /// |limit(0),min,c2____________c1|
    ///
    /// Expectation:
    /// Swap will fail due to partial fill.
    fn sqrt_price_limit_0_a_to_b_exact_out() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: -440321, // c1
            start_tick_index: -451584,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: 0,              // no explicit limit
            amount_specified_is_input: false, // exact out
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// An attempt to swap to the maximum tick explicitly without the last initializable tick
    /// being initialized
    /// |c1_______________c2,max,limit(MAX_SQRT_PRICE_X64)|
    ///
    /// Expectation:
    /// Swap will succeed with partial fill.
    fn sqrt_price_limit_explicit_max_b_to_a_exact_out() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: 442369, // c1
            start_tick_index: 442368,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: MAX_SQRT_PRICE_X64, // explicit limit
            amount_specified_is_input: false,     // exact out
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: 443636, // MAX
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        );
    }

    #[test]
    /// An attempt to swap to the minimum tick explicitly without the last initializable tick
    /// being initialized
    /// |limit(MIN_SQRT_PRICE_X64),min,c2____________c1|
    ///
    /// Expectation:
    /// Swap will succeed with partial fill.
    fn sqrt_price_limit_explicit_min_a_to_b_exact_out() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: -440321, // c1
            start_tick_index: -451584,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: MIN_SQRT_PRICE_X64, // explicit limit
            amount_specified_is_input: false,     // exact out
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: -443636 - 1, // MIN - 1 (shifted)
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        );
    }

    #[test]
    /// An attempt to swap to the maximum tick implicitly without the last initializable tick
    /// being initialized
    /// |c1_______________c2,max,limit(0)|
    ///
    /// Expectation:
    /// The swap will succeed and exits at the maximum tick index.
    /// In exact in mode, partial fill may be allowed if other_amount_threshold is satisfied.
    fn sqrt_price_limit_0_b_to_a_exact_in() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: 442369, // c1
            start_tick_index: 442368,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: 0,             // no explicit limit
            amount_specified_is_input: true, // exact in
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: 443636, // MAX
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        );
    }

    #[test]
    /// An attempt to swap to the minimum tick implicitly without the last initializable tick
    /// being initialized
    /// |limit(0),min,c2____________c1|
    ///
    /// Expectation:
    /// The swap will succeed and exits at the minimum tick index.
    /// In exact in mode, partial fill may be allowed if other_amount_threshold is satisfied.
    fn sqrt_price_limit_0_a_to_b_exact_in() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: -440321, // c1
            start_tick_index: -451584,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: 0,             // no explicit limit
            amount_specified_is_input: true, // exact in
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 0,
                traded_amount_b: 0,
                end_tick_index: -443636 - 1, // MIN - 1 (shifted)
                end_liquidity: 0,
                end_reward_growths: [0, 0, 0],
            },
        );
    }
}

#[cfg(test)]
mod swap_error_tests {
    use super::*;
    use crate::util::test_utils::swap_test_fixture::*;

    #[test]
    #[should_panic(expected = "TickArraySequenceInvalidIndex")]
    /// A swap with a price limit outside of the tick-range and a large
    /// enough expected trade amount to move the next tick-index out of the tick-range
    /// limit,c2...|____________|_________________|____c1__________|
    ///
    /// Expectation:
    /// Fail on InvalidTickSequence as the tick-range is insufficent for the trade request.
    fn insufficient_tick_array_range_test_a_to_b() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000,
            curr_tick_index: 0, // c1
            start_tick_index: 0,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(-5576), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    #[should_panic(expected = "TickArraySequenceInvalidIndex")]
    /// A swap with a price limit outside of the tick-range and a large
    /// enough expected trade amount to move the next tick-index out of the tick-range
    /// |__c1__________|_________________|______________|...limit,c2
    ///
    /// Expectation:
    /// Fail on InvalidTickSequence as the tick-range is insufficent for the trade request.
    fn insufficient_tick_array_range_test_b_to_a() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000,
            curr_tick_index: 0, // c1
            start_tick_index: 0,
            trade_amount: 1_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(5576), // limit
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    /// A swap with the pool's current tick index at sqrt-price 0.
    ///
    /// Expectation:
    /// The swap should succeed without dividing by 0.
    fn swap_starts_from_sqrt_price_0() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: 0, // c1
            start_tick_index: 0,
            trade_amount: 1_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(576), // limit
            amount_specified_is_input: false,
            a_to_b: false,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 1000000,
                traded_amount_b: 1000201,
                end_tick_index: 4,
                end_liquidity: 5_000_000_000,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    /// A swap with the pool's next tick index at sqrt-price 0.
    ///
    /// Expectation:
    /// The swap should succeed without dividing by 0.
    fn swap_ends_at_sqrt_price_0() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 119900,
            curr_tick_index: 10, // c1
            start_tick_index: 0,
            trade_amount: 59,
            sqrt_price_limit: sqrt_price_from_tick_index(-5), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.run(&mut tick_sequence, 100);
        assert_swap(
            &post_swap,
            &SwapTestExpectation {
                traded_amount_a: 59,
                traded_amount_b: 59,
                end_tick_index: 0,
                end_liquidity: 119900,
                end_reward_growths: [0, 0, 0],
            },
        )
    }

    #[test]
    #[should_panic(expected = "ZeroTradableAmount")]
    /// A swap with zero tradable amount.
    ///
    /// Expectation
    /// The swap should go through without moving the price and swappping anything.
    fn swap_zero_tokens() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_8,
            liquidity: 5_000_000_000,
            curr_tick_index: -225365, // c1
            start_tick_index: -225792,
            trade_amount: 0,
            sqrt_price_limit: sqrt_price_from_tick_index(-225380), // limit
            amount_specified_is_input: false,
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    #[should_panic(expected = "InvalidTimestamp")]
    /// A swap with an invalid timestamp.
    ///
    /// Expectation
    /// The swap should fail due to the current timestamp being stale.
    fn swap_invalid_timestamp() {
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 500_000,
            curr_tick_index: -322176,
            start_tick_index: -322176,
            trade_amount: 1_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(0),
            amount_specified_is_input: false,
            a_to_b: false,
            reward_last_updated_timestamp: 1000,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }

    #[test]
    #[should_panic(expected = "AmountCalcOverflow")]
    // Swapping at high liquidity/price can lead to an amount calculated
    // overflow u64
    //
    // Expectation
    // The swap should fail to do amount calculated overflowing.
    fn swap_does_not_overflow() {
        // Use filled arrays to minimize the overflow from calculations, rather than accumulation
        let array_1_ticks: Vec<TestTickInfo> = build_filled_tick_array(439296, TS_128);
        let array_2_ticks: Vec<TestTickInfo> = build_filled_tick_array(439296 - 88 * 128, TS_128);
        let array_3_ticks: Vec<TestTickInfo> =
            build_filled_tick_array(439296 - 2 * 88 * 128, TS_128);
        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: (u32::MAX as u128) << 2,
            curr_tick_index: MAX_TICK_INDEX - 1, // c1
            start_tick_index: 439296,
            trade_amount: 1_000_000_000_000,
            sqrt_price_limit: sqrt_price_from_tick_index(0), // limit
            amount_specified_is_input: true,
            array_1_ticks: &array_1_ticks,
            array_2_ticks: Some(&array_2_ticks),
            array_3_ticks: Some(&array_3_ticks),
            a_to_b: true,
            ..Default::default()
        });
        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        swap_test_info.run(&mut tick_sequence, 100);
    }
}

#[cfg(test)]
mod adaptive_fee_tests {
    use std::collections::HashMap;

    use super::*;
    use crate::{
        manager::fee_rate_manager::{
            ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR, FEE_RATE_HARD_LIMIT,
            REDUCTION_FACTOR_DENOMINATOR, VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
        },
        util::test_utils::swap_test_fixture::*,
    };

    const A_TO_B: bool = true;
    const B_TO_A: bool = false;

    #[derive(Debug)]
    struct ExpectedSwapResult {
        input_amount: u64,
        output_amount: u64,
        #[allow(dead_code)]
        fee: u64,
        protocol_fee: u64,
        end_sqrt_price: u128,
        next_adaptive_fee_variables: AdaptiveFeeVariables,
    }

    #[allow(clippy::too_many_arguments)]
    fn get_expected_result(
        a_to_b: bool,
        start_sqrt_price: u128,
        start_liquidity: u128,
        initialized_liquidity_net_map: HashMap<i32, i128>,
        first_boundary_tick_index: i32,
        trade_amount: u64,
        static_fee_rate: u16,
        protocol_fee_rate: u16,
        adaptive_fee_info: AdaptiveFeeInfo,
        first_tick_group_index: i32,
        current_timestamp: u64,
    ) -> ExpectedSwapResult {
        _get_expected_result(
            a_to_b,
            start_sqrt_price,
            start_liquidity,
            initialized_liquidity_net_map,
            first_boundary_tick_index,
            trade_amount,
            static_fee_rate,
            protocol_fee_rate,
            adaptive_fee_info,
            first_tick_group_index,
            current_timestamp,
            HashMap::new(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn get_expected_result_with_max_volatility_skip(
        a_to_b: bool,
        start_sqrt_price: u128,
        start_liquidity: u128,
        initialized_liquidity_net_map: HashMap<i32, i128>,
        first_boundary_tick_index: i32,
        trade_amount: u64,
        static_fee_rate: u16,
        protocol_fee_rate: u16,
        adaptive_fee_info: AdaptiveFeeInfo,
        first_tick_group_index: i32,
        current_timestamp: u64,
        // (skip from tick group index, next tick index)
        expected_max_volatility_skip_range: HashMap<i32, i32>,
    ) -> ExpectedSwapResult {
        _get_expected_result(
            a_to_b,
            start_sqrt_price,
            start_liquidity,
            initialized_liquidity_net_map,
            first_boundary_tick_index,
            trade_amount,
            static_fee_rate,
            protocol_fee_rate,
            adaptive_fee_info,
            first_tick_group_index,
            current_timestamp,
            expected_max_volatility_skip_range,
        )
    }

    // another implementation of swap loop to generate expected result
    #[allow(clippy::too_many_arguments)]
    fn _get_expected_result(
        a_to_b: bool,
        start_sqrt_price: u128,
        start_liquidity: u128,
        initialized_liquidity_net_map: HashMap<i32, i128>,
        first_boundary_tick_index: i32,
        trade_amount: u64,
        static_fee_rate: u16,
        protocol_fee_rate: u16,
        adaptive_fee_info: AdaptiveFeeInfo,
        first_tick_group_index: i32,
        current_timestamp: u64,
        // (skip from tick group index, next tick index)
        expected_max_volatility_skip_range: HashMap<i32, i32>,
    ) -> ExpectedSwapResult {
        let mut remaining_input_amount = trade_amount;

        let mut curr_liquidity = start_liquidity;

        let mut curr_sqrt_price = start_sqrt_price;
        let mut next_tick_index = first_boundary_tick_index;

        let mut curr_fee = 0u64;
        let mut curr_protocol_fee = 0u64;
        let mut output_amount = 0u64;

        let sqrt_price_limit = if a_to_b {
            MIN_SQRT_PRICE_X64
        } else {
            MAX_SQRT_PRICE_X64
        };

        let tick_group_size = adaptive_fee_info.constants.tick_group_size;
        let adaptive_fee_control_factor = adaptive_fee_info.constants.adaptive_fee_control_factor;
        let max_volatility_accumulator = adaptive_fee_info.constants.max_volatility_accumulator;

        // update reference
        let elapsed = current_timestamp
            - adaptive_fee_info
                .variables
                .last_reference_update_timestamp
                .max(adaptive_fee_info.variables.last_major_swap_timestamp);
        let (
            next_last_reference_update_timestamp,
            tick_group_index_reference,
            volatility_reference,
        ) = if elapsed < adaptive_fee_info.constants.filter_period as u64 {
            // high frequency trade
            // no change
            (
                adaptive_fee_info.variables.last_reference_update_timestamp,
                adaptive_fee_info.variables.tick_group_index_reference,
                adaptive_fee_info.variables.volatility_reference,
            )
        } else if elapsed < adaptive_fee_info.constants.decay_period as u64 {
            // NOT high frequency trade
            (
                current_timestamp,
                first_tick_group_index,
                (u64::from(adaptive_fee_info.variables.volatility_accumulator)
                    * u64::from(adaptive_fee_info.constants.reduction_factor)
                    / u64::from(REDUCTION_FACTOR_DENOMINATOR)) as u32,
            )
        } else {
            // Out of decay time window
            (current_timestamp, first_tick_group_index, 0)
        };
        let mut accumulator = adaptive_fee_info.variables.volatility_accumulator;

        let mut tick_group_index = first_tick_group_index;
        let mut iteration = 0;
        while remaining_input_amount > 0 && curr_sqrt_price != sqrt_price_limit {
            let tick_group_index_delta = if tick_group_index > tick_group_index_reference {
                tick_group_index - tick_group_index_reference
            } else {
                tick_group_index_reference - tick_group_index
            };

            // determine fee rate
            accumulator = u64::min(
                volatility_reference as u64
                    + tick_group_index_delta as u64 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u64,
                max_volatility_accumulator as u64,
            )
            .try_into()
            .unwrap();
            let crossed = accumulator as u64 * tick_group_size as u64;
            let squared = crossed * crossed;
            let adaptive_fee_rate = ceil_division(
                u128::from(adaptive_fee_control_factor) * u128::from(squared),
                u128::from(ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR)
                    * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR)
                    * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR),
            );
            let capped_adaptive_fee_rate =
                u128::min(adaptive_fee_rate, u128::from(FEE_RATE_HARD_LIMIT));

            // total fee rate (static + adaptive)
            let fee_rate = u32::min(
                static_fee_rate as u32 + capped_adaptive_fee_rate as u32,
                FEE_RATE_HARD_LIMIT,
            );

            let expected_skip = expected_max_volatility_skip_range.get(&tick_group_index);

            // swap step
            if let Some(skip_next_tick_index) = expected_skip {
                next_tick_index = *skip_next_tick_index;
            }
            let next_sqrt_price =
                sqrt_price_from_tick_index(next_tick_index.clamp(MIN_TICK_INDEX, MAX_TICK_INDEX));

            println!(
                "remaining: {}, group_index:  {}, liq: {}, current_tick_index -> next_tick_index: {} -> {}, total fee rate: {}",
                remaining_input_amount, tick_group_index, curr_liquidity,
                tick_index_from_sqrt_price(&curr_sqrt_price),
                next_tick_index, fee_rate
            );
            let step_result = compute_swap(
                remaining_input_amount,
                fee_rate,
                curr_liquidity,
                curr_sqrt_price,
                next_sqrt_price,
                true,
                a_to_b,
            )
            .unwrap();

            // update amounts
            remaining_input_amount = remaining_input_amount
                .checked_sub(step_result.amount_in + step_result.fee_amount)
                .unwrap();
            output_amount += step_result.amount_out;
            curr_fee += step_result.fee_amount;
            curr_protocol_fee = calculate_fees(
                step_result.fee_amount,
                protocol_fee_rate,
                curr_liquidity,
                curr_protocol_fee,
                0,
            )
            .0;

            // update liquidity
            if let Some(liquidity_net) = initialized_liquidity_net_map.get(&next_tick_index) {
                let signed_liquidity_net = if a_to_b {
                    -(*liquidity_net)
                } else {
                    *liquidity_net
                };
                curr_liquidity = if signed_liquidity_net >= 0 {
                    curr_liquidity
                        .checked_add(signed_liquidity_net as u128)
                        .unwrap()
                } else {
                    curr_liquidity
                        .checked_sub(signed_liquidity_net.unsigned_abs())
                        .unwrap()
                }
            }

            // update loop vars
            curr_sqrt_price = step_result.next_price;
            if let Some(skip_next_tick_index) = expected_skip {
                tick_group_index = if a_to_b {
                    floor_division(*skip_next_tick_index, tick_group_size as i32) - 1
                } else {
                    floor_division(*skip_next_tick_index, tick_group_size as i32)
                };

                next_tick_index = if a_to_b {
                    tick_group_index * tick_group_size as i32
                } else {
                    tick_group_index * tick_group_size as i32 + tick_group_size as i32
                };
            } else {
                next_tick_index += if a_to_b {
                    -(tick_group_size as i32)
                } else {
                    tick_group_size as i32
                };
                tick_group_index += if a_to_b { -1 } else { 1 };
            }

            iteration += 1;
            if iteration > TICK_ARRAY_SIZE * 3 {
                panic!("overrun");
            }
        }

        // is_major_swap alternative implementation with U256
        let sqrt_price_factor = sqrt_price_from_tick_index(
            adaptive_fee_info.constants.major_swap_threshold_ticks as i32,
        );
        let (smaller_sqrt_price, larger_sqrt_price) = if curr_sqrt_price < sqrt_price_factor {
            (curr_sqrt_price, sqrt_price_factor)
        } else {
            (sqrt_price_factor, curr_sqrt_price)
        };

        let major_swap_sqrt_price_target =
            ((U256::from(smaller_sqrt_price) * U256::from(sqrt_price_factor)) >> 64)
                .try_into_u128()
                .unwrap();
        let is_major_swap = larger_sqrt_price >= major_swap_sqrt_price_target;

        let next_last_major_swap_timestamp = if is_major_swap {
            current_timestamp
        } else {
            adaptive_fee_info.variables.last_major_swap_timestamp
        };

        ExpectedSwapResult {
            input_amount: trade_amount - remaining_input_amount,
            output_amount,
            fee: curr_fee,
            protocol_fee: curr_protocol_fee,
            end_sqrt_price: curr_sqrt_price,
            next_adaptive_fee_variables: AdaptiveFeeVariables {
                last_reference_update_timestamp: next_last_reference_update_timestamp,
                last_major_swap_timestamp: next_last_major_swap_timestamp,
                tick_group_index_reference,
                volatility_reference,
                volatility_accumulator: accumulator,
                ..Default::default()
            },
        }
    }

    fn get_mid_sqrt_price(left_tick_index: i32, right_tick_index: i32) -> u128 {
        let left_sqrt_price = sqrt_price_from_tick_index(left_tick_index);
        let right_sqrt_price = sqrt_price_from_tick_index(right_tick_index);
        (left_sqrt_price + right_sqrt_price) / 2
    }

    fn check_next_adaptive_fee_variables(
        result: &AdaptiveFeeVariables,
        expected: &AdaptiveFeeVariables,
    ) {
        let result_last_reference_update_timestamp = result.last_reference_update_timestamp;
        let expected_last_reference_update_timestamp = expected.last_reference_update_timestamp;
        assert_eq!(
            result_last_reference_update_timestamp,
            expected_last_reference_update_timestamp
        );
        let result_last_major_swap_timestamp = result.last_major_swap_timestamp;
        let expected_last_major_swap_timestamp = expected.last_major_swap_timestamp;
        assert_eq!(
            result_last_major_swap_timestamp,
            expected_last_major_swap_timestamp
        );

        let result_tick_group_index_reference = result.tick_group_index_reference;
        let expected_tick_group_index_reference = expected.tick_group_index_reference;
        assert_eq!(
            result_tick_group_index_reference,
            expected_tick_group_index_reference
        );
        let result_volatility_reference = result.volatility_reference;
        let expected_volatility_reference = expected.volatility_reference;
        assert_eq!(result_volatility_reference, expected_volatility_reference);
        let result_volatility_accumulator = result.volatility_accumulator;
        let expected_volatility_accumulator = expected.volatility_accumulator;
        assert_eq!(
            result_volatility_accumulator,
            expected_volatility_accumulator
        );
    }

    mod single_swap {
        use super::*;

        mod ts_64 {
            use super::*;

            const TS: u16 = 64;
            const TICK_GROUP_SIZE: u16 = TS;

            fn adaptive_fee_info_without_max_volatility_skip() -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 5_000,
                        reduction_factor: 500,
                        // block skip based on max_volatility_accumulator
                        max_volatility_accumulator: 88 * 3 * 10_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, sqrt price is on an initializable tick(0) (not shifted)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [-64, 0] range is 1.
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                  c2<-----c1
            fn tick_index_0_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                //let af_constants = adaptive_fee_info.as_ref().unwrap().constants;
                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-2816, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(0) (not shifted)
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                      c1----->c2
            fn tick_index_0_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(1408, -500_000), (2816, -1_000_000)].into_iter().collect(),
                    64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on an initializable tick(0) (SHIFTED)
            /// notes:
            /// - first tick group index should be -1
            /// - the delta of tick group index for [-64, 0] range is 0.
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                  c2<-----c1
            fn tick_index_0_shifted_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-2816, 1_000_000)].into_iter().collect(),
                    -64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -1,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(0) (SHIFTED)
            /// notes:
            /// - first tick group index should be -1
            /// - the delta of tick group index for [0, 64] range is 1.
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                      c1----->c2
            fn tick_index_0_shifted_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (1408, -500_000), (2816, -1_000_000)]
                        .into_iter()
                        .collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -1,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is NOT on an initializable tick (between tick index 0 ~ 1)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 64] range is 0.
            /// - the delta of tick group index for [-64, 0] range is 1.
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                    c2<-----c1
            fn tick_index_mid_0_and_1_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    curr_sqrt_price_override: Some(get_mid_sqrt_price(0, 1)),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-2816, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is NOT on an initializable tick (between tick index 0 ~ 1)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 64] range is 0.
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                       c1----->c2
            fn tick_index_mid_0_and_1_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    curr_sqrt_price_override: Some(get_mid_sqrt_price(0, 1)),
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(1408, -500_000), (2816, -1_000_000)].into_iter().collect(),
                    64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is NOT on an initializable tick (32)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 64] range is 0.
            /// - the delta of tick group index for [-64, 0] range is 1.
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<-----c1
            fn tick_index_32_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-2816, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is NOT on an initializable tick (32)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 64] range is 0.
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                        c1----->c2
            fn tick_index_32_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 32,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(1408, -500_000), (2816, -1_000_000)].into_iter().collect(),
                    64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on an initializable tick (64, but not initialized)
            /// notes:
            /// - first tick group index should be 1
            /// - the delta of tick group index for [64, 128] range is 0.
            /// - the delta of tick group index for [0, 64] range is 1.
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                      c2<-----c1
            fn tick_index_64_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 64,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-2816, 1_000_000)].into_iter().collect(),
                    64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    1,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick (64, but not initialized)
            /// notes:
            /// - first tick group index should be 1
            /// - the delta of tick group index for [64, 128] range is 0.
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                         c1----->c2
            fn tick_index_64_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 64,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(1408, -500_000), (2816, -1_000_000)].into_iter().collect(),
                    128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    1,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on an initializable tick (64, but not initialized, SHIFTED)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 64] range is 0.
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                      c2<-----c1
            fn tick_index_64_shifted_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 64 - 1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(64)),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-2816, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick (64, but not initialized, SHIFTED)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [64, 128] range is 1.
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                         c1----->c2
            fn tick_index_64_shifted_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 64 - 1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(64)),
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(1408, -500_000), (2816, -1_000_000)].into_iter().collect(),
                    64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, hit MAX_SQRT_PRICE (partial fill)
            ///
            /// 428032               433664               439296    443584 (full range index)
            ///                               p1---------------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///                      c1--------------------------------->c2 (443636)
            fn hit_max_sqrt_price_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 433664,
                    start_tick_index: 428032,
                    trade_amount: 1_500_000_000_000,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 439296 - 2816,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 443584,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(439296 - 2816, p1_liquidity), (443584, -p1_liquidity)]
                        .into_iter()
                        .collect(),
                    433664 + 64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    6776,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: expected.input_amount, // partial fill
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 0, // no liquidity at MAX_SQRT_PRICE
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                assert_eq!(expected.end_sqrt_price, MAX_SQRT_PRICE_X64);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, from MAX_SQRT_PRICE
            ///
            /// 428032               433664               439296    443584 (full range index)
            ///                               p1---------------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<--------------------c1 (443636)
            fn from_max_sqrt_price_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100_000_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 443636,
                    start_tick_index: 439296,
                    trade_amount: 200,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 443584,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 439296 - 2816,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(443584, -p1_liquidity), (439296 - 2816, p1_liquidity)]
                        .into_iter()
                        .collect(),
                    443584,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    6931,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: p1_liquidity.unsigned_abs(),
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, hit MIN_SQRT_PRICE (partial fill)
            ///
            /// -444928     -443584  -439296              -433664
            ///             p1-----------------p1: 100
            /// |--------------------|--------------------|--------------------|
            /// (-443636) c2<-----------------------------c1
            fn hit_min_sqrt_price_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 1_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -433664,
                    start_tick_index: -433664,
                    trade_amount: 1_500_000_000_000,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -439296 + 2816,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -443584,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-439296 + 2816, -p1_liquidity), (-443584, p1_liquidity)]
                        .into_iter()
                        .collect(),
                    -433664,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -6776,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.input_amount, // partial fill
                        traded_amount_b: expected.output_amount,
                        end_tick_index: -443636 - 1, // shifted
                        end_liquidity: 0,            // no liquidity at MIN_SQRT_PRICE
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                assert_eq!(expected.end_sqrt_price, MIN_SQRT_PRICE_X64);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, from MIN_SQRT_PRICE
            ///
            /// -444928     -443584  -439296              -433664
            ///             p1-----------------p1: 100
            /// |--------------------|--------------------|--------------------|
            /// (-443636) c1--------------->c2
            fn from_min_sqrt_price_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 1_000_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -443637, // shifted
                    curr_sqrt_price_override: Some(MIN_SQRT_PRICE_X64),
                    start_tick_index: -444928,
                    trade_amount: 200,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -443584,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -439296 + 2816,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-443584, p1_liquidity), (-439296 + 2816, -p1_liquidity)]
                        .into_iter()
                        .collect(),
                    -443584,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -6932,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: p1_liquidity.unsigned_abs(),
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }
        }

        mod ts_1 {
            use super::*;

            const TS: u16 = 1;
            const TICK_GROUP_SIZE: u16 = TS;

            fn adaptive_fee_info_without_max_volatility_skip() -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 50_000,
                        reduction_factor: 500,
                        // block skip based on max_volatility_accumulator
                        max_volatility_accumulator: 88 * 3 * 10_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, sqrt price is on an initializable tick(0) (not shifted)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [-1, 0] range is 1.
            ///
            /// -176                 -88                  0                    88
            ///                                           p2------p2：500_000
            ///                                p1--------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                  c2<-----c1
            fn tick_index_0_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    start_tick_index: 0,
                    trade_amount: 2_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 22,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 44,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -44,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-44, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(0) (not shifted)
            ///
            /// -88                  0                    88                   176
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                      c1----->c2
            fn tick_index_0_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    start_tick_index: -88,
                    trade_amount: 2_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -44,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 22,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 44,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(22, -500_000), (44, -1_000_000)].into_iter().collect(),
                    1,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on an initializable tick(0) (SHIFTED)
            /// notes:
            /// - first tick group index should be -1
            /// - the delta of tick group index for [-1, 0] range is 0.
            ///
            /// -176                 -88                  0                    88
            ///                                           p2---p2：500_000
            ///                                     p3----p3: 100_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                  c2<-----c1
            fn tick_index_0_shifted_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 100_000,
                    curr_tick_index: -1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                    start_tick_index: 0,
                    trade_amount: 2_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p3
                            index: 0,
                            liquidity_net: -100_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 22,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 44,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p1
                            index: -44,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: -22,
                            liquidity_net: 100_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-22, 100_000), (-44, 1_000_000)].into_iter().collect(),
                    -1,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -1,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(0) (SHIFTED)
            /// notes:
            /// - first tick group index should be -1
            /// - the delta of tick group index for [0, 1] range is 1.
            ///
            /// -88                  0                    88                   176
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                      c1----->c2
            fn tick_index_0_shifted_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                    start_tick_index: -88,
                    trade_amount: 2_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -44,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 22,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 44,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (22, -500_000), (44, -1_000_000)]
                        .into_iter()
                        .collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -1,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is NOT on an initializable tick (between tick index 0 ~ 1)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 1] range is 0.
            /// - the delta of tick group index for [-1, 0] range is 1.
            ///
            /// -176                 -88                  0                    88
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                    c2<-----c1
            fn tick_index_mid_0_and_1_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    curr_sqrt_price_override: Some(get_mid_sqrt_price(0, 1)),
                    start_tick_index: 0,
                    trade_amount: 2_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 22,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 44,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -44,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(0, 500_000), (-44, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is NOT on an initializable tick (between tick index 0 ~ 1)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 1] range is 0.
            ///
            /// -88                  0                    88                   176
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                       c1----->c2
            fn tick_index_mid_0_and_1_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    curr_sqrt_price_override: Some(get_mid_sqrt_price(0, 1)),
                    start_tick_index: -88,
                    trade_amount: 2_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -44,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 22,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 44,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(22, -500_000), (44, -1_000_000)].into_iter().collect(),
                    1,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, hit MAX_SQRT_PRICE (partial fill)
            ///
            /// 443432               443520               443608    443636 (full range index)
            ///                               p1---------------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///                      c1----------------------------->c2 (443636)
            fn hit_max_sqrt_price_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 443520,
                    start_tick_index: 443432,
                    trade_amount: 1_500_000_000_000,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 443608 - 44,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 443636,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(443608 - 44, p1_liquidity), (443636, -p1_liquidity)]
                        .into_iter()
                        .collect(),
                    443520 + 1,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    443520,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: expected.input_amount, // partial fill
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 0, // no liquidity at MAX_SQRT_PRICE
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                assert_eq!(expected.end_sqrt_price, MAX_SQRT_PRICE_X64);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, from MAX_SQRT_PRICE
            ///
            /// 443432               443520               443608    443636 (full range index)
            ///                               p1---------------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<--------------c1 (443636)
            fn from_max_sqrt_price_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100_000_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 443636,
                    start_tick_index: 443608,
                    trade_amount: 130,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 443636,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 443608 - 44,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(443636, -p1_liquidity), (443608 - 44, p1_liquidity)]
                        .into_iter()
                        .collect(),
                    443636,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    443636,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: p1_liquidity.unsigned_abs(),
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, hit MIN_SQRT_PRICE (partial fill)
            ///
            /// -443696     -443636  -443608              -443520
            ///             p1-----------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///   (-443636) c2<---------------------------c1
            fn hit_min_sqrt_price_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 1_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -443520,
                    start_tick_index: -443520,
                    trade_amount: 1_500_000_000_000,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -443608 + 44,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -443636,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-443608 + 44, -p1_liquidity), (-443636, p1_liquidity)]
                        .into_iter()
                        .collect(),
                    -443520,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -443520,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.input_amount, // partial fill
                        traded_amount_b: expected.output_amount,
                        end_tick_index: -443636 - 1, // shifted
                        end_liquidity: 0,            // no liquidity at MIN_SQRT_PRICE
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                assert_eq!(expected.end_sqrt_price, MIN_SQRT_PRICE_X64);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, from MIN_SQRT_PRICE
            ///
            /// -443696     -443636  -443608              -443520
            ///             p1-----------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///   (-443636) c1------------->c2
            fn from_min_sqrt_price_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 1_000_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -443637, // shifted
                    curr_sqrt_price_override: Some(MIN_SQRT_PRICE_X64),
                    start_tick_index: -443696,
                    trade_amount: 130,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -443636,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -443608 + 44,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-443636, p1_liquidity), (-443608 + 44, -p1_liquidity)]
                        .into_iter()
                        .collect(),
                    -443636,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -443637,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: p1_liquidity.unsigned_abs(),
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }
        }

        mod ts_32896 {
            use super::*;

            const TS: u16 = 32896; // 2^15 + 128 (ts for Full range only pool (aka SplashPool))
            const TICK_GROUP_SIZE: u16 = 128; // TS is too large

            fn adaptive_fee_info_without_max_volatility_skip() -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 5_000,
                        reduction_factor: 500,
                        // block skip based on max_volatility_accumulator
                        max_volatility_accumulator: 88 * 3 * 10_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, sqrt price is on tick(0) (not initializable in Full Range Only pool, not shifted)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [-128, 0] range is 1.
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                   c2<------c1
            fn tick_index_0_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 0,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on tick(0) (not initializable in Full Range Only pool, not shifted)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                            c1----->c2
            fn tick_index_0_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 0,
                    start_tick_index: -2894848,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(128) (not initializable in Full Range Only pool, not shifted)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 128] range is 1.
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                    c2<------c1
            fn tick_index_128_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 128,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    1,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on tick(128) (not initializable in Full Range Only pool, not shifted)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                              c1----->c2
            fn tick_index_128_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 128,
                    start_tick_index: -2894848,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    256,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    1,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on tick(-1024) (not initializable in Full Range Only pool, not shifted)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                        c1----->c2
            fn tick_index_neg_1024_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1024,
                    start_tick_index: -2894848,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    -1024 + 128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -8,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(-1024) (not initializable in Full Range Only pool, not shifted)
            /// notes:
            /// - first tick group index should be 0
            /// - the delta of tick group index for [0, 128] range is 1.
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                c2<------c1
            fn tick_index_neg_1024_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1024,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    -1024,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -8,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(427648) (not shifted)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                                   c2<------c1
            fn tick_index_427648_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 427648,
                    start_tick_index: 0,
                    trade_amount: 300,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    427648,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    3341,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(427648) (not shifted)
            /// notes:
            /// - no liquidity = partial fill
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                                            c1----->c2
            fn tick_index_427648_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 427648,
                    start_tick_index: -2894848,
                    trade_amount: 150_000,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [].into_iter().collect(),
                    427648 + 128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    3341,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: expected.input_amount, // partial fill
                        end_tick_index: tick_index_from_sqrt_price(&MAX_SQRT_PRICE_X64),
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(427648) (SHIFTED)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                                   c2<------c1
            fn tick_index_427648_shifted_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 427647, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(427648)),
                    start_tick_index: 0,
                    trade_amount: 300,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    427648 - 128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    3340,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(427648) (SHIFTED)
            /// notes:
            /// - no liquidity = partial fill
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                                            c1----->c2
            fn tick_index_427648_shifted_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 427647, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(427648)),
                    start_tick_index: -2894848,
                    trade_amount: 150_000,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    427648,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    3340,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: expected.input_amount, // partial fill
                        end_tick_index: tick_index_from_sqrt_price(&MAX_SQRT_PRICE_X64),
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(-427648) (not shifted)
            /// notes:
            /// - no liquidity = partial fill
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///     c2<---c1
            fn tick_index_neg_427648_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -427648,
                    start_tick_index: 0,
                    trade_amount: 300,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    -427648,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -3341,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.input_amount, // partial fill
                        traded_amount_b: expected.output_amount,
                        end_tick_index: -443636 - 1, // shifted
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(-427648) (not shifted)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///           c1--->c2
            fn tick_index_neg_427648_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -427648,
                    start_tick_index: -2894848,
                    trade_amount: 300,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    -427648 + 128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -3341,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[0].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(-427648) (SHIFTED)
            /// notes:
            /// - no liquidity = partial fill
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///     c2<---c1
            fn tick_index_neg_427648_shifted_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -427648 - 1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(-427648)),
                    start_tick_index: 0,
                    trade_amount: 300,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [].into_iter().collect(),
                    -427648 - 128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -3342,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.input_amount, // partial fill
                        traded_amount_b: expected.output_amount,
                        end_tick_index: -443636 - 1, // shifted
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(-427648) (SHIFTED)
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///           c1--->c2
            fn tick_index_neg_427648_shifted_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -427648 - 1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(-427648)),
                    start_tick_index: -2894848,
                    trade_amount: 300,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000), (427648, -1_000_000)]
                        .into_iter()
                        .collect(),
                    -427648,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -3342,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[0].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on tick(427136)
            /// notes:
            /// - partial fill
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 100
            /// |--------------------------|--------------------------|
            ///                                         c1----->c2 (443636)
            fn hit_max_sqrt_price_cross_full_range_tick_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: p1_liquidity.unsigned_abs(),
                    curr_tick_index: 427648 - 512,
                    start_tick_index: -2894848,
                    trade_amount: 1_500_000_000_000,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -p1_liquidity)].into_iter().collect(),
                    427648 - 512 + 128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    3337,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: expected.input_amount, // partial fill
                        end_tick_index: tick_index_from_sqrt_price(&MAX_SQRT_PRICE_X64),
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on MAX_SQRT_PRICE
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                                      c2<------c1 (443636)
            fn from_max_sqrt_price_cross_full_range_tick_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 443636,
                    start_tick_index: 0,
                    trade_amount: 200,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    443520,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    3465,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, sqrt price is on tick(-427648) (not shifted)
            /// notes:
            /// - partial fill
            ///
            ///      -2894848                   0                          2894848
            ///             -427648 (full range)              427648 (full range)
            ///                p1-------------------------------p1: 1_000_000
            ///      |--------------------------|--------------------------|
            ///   (-443636) c2<---c1
            fn hit_min_sqrt_price_cross_full_range_tick_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: p1_liquidity.unsigned_abs(),
                    curr_tick_index: -427648 + 512,
                    start_tick_index: 0,
                    trade_amount: 1_500_000_000_000,
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, p1_liquidity)].into_iter().collect(),
                    -427648 + 512,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -3337,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.input_amount, // partial fill
                        traded_amount_b: expected.output_amount,
                        end_tick_index: -443636 - 1, // shifted
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, sqrt price is on an initializable tick(-427648) (not shifted)
            ///
            ///     -2894848                   0                          2894848
            ///            -427648 (full range)              427648 (full range)
            ///               p1-------------------------------p1: 1_000_000
            ///     |--------------------------|--------------------------|
            ///   (-443637)c1--->c2
            fn from_min_sqrt_price_cross_full_range_tick_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -443636 - 1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(-443636)),
                    start_tick_index: -2894848,
                    trade_amount: 200,
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    -443648 + 128, // -443648 = floor(-443637 / 128) * 128
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -3466,
                    1_000_000,
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[0].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }
        }

        mod ts_64_with_zero_liquidity_skip {
            use super::*;

            const TS: u16 = 64;
            const TICK_GROUP_SIZE: u16 = TS;

            fn adaptive_fee_info_without_max_volatility_skip() -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 5_000,
                        reduction_factor: 500,
                        // block skip based on max_volatility_accumulator
                        max_volatility_accumulator: 88 * 3 * 10_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, zero liquidity range: [-1408, 1408]
            /// - swap_test_info.run (swap loop implementation) uses "skip"
            /// - get_expected_result does NOT uses "skip"
            /// - but both should return the same result
            ///
            /// -11264               -5632                0                   5632
            ///                                p2----p2：5_000_000
            ///                                               p1----p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                   c2<----------------------c1
            fn tick_index_4224_a_to_b_crossing_large_liquidity_zero_range() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 4224,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p1
                            index: 1408,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: -1408,
                            liquidity_net: -5_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: -2816,
                            liquidity_net: 5_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                //let af_constants = adaptive_fee_info.as_ref().unwrap().constants;
                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [
                        (2816, -1_000_000),
                        (1408, 1_000_000),
                        (-1408, -5_000_000),
                        (-2816, 5_000_000),
                    ]
                    .into_iter()
                    .collect(),
                    4224,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    66,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 5_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// a to b, zero liquidity range: [-1408, -1344] (1 tick_spacing)
            /// - swap_test_info.run (swap loop implementation) uses "skip"
            /// - get_expected_result does NOT uses "skip"
            /// - but both should return the same result
            ///
            /// -11264               -5632                0                   5632
            ///                                p2----p2：5_000_000
            ///                                       p1------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                   c2<----------------------c1
            fn tick_index_4224_a_to_b_crossing_minimum_liquidity_zero_range() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 4224,
                    start_tick_index: 0,
                    trade_amount: 500_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 2816,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p1
                            index: -1344,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: -1408,
                            liquidity_net: -5_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: -2816,
                            liquidity_net: 5_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                //let af_constants = adaptive_fee_info.as_ref().unwrap().constants;
                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [
                        (2816, -1_000_000),
                        (-1344, 1_000_000),
                        (-1408, -5_000_000),
                        (-2816, 5_000_000),
                    ]
                    .into_iter()
                    .collect(),
                    4224,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    66,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 5_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, zero liquidity range: [-1408, 1408]
            /// notes:
            /// - swap_test_info.run (swap loop implementation) uses "skip"
            /// - get_expected_result does NOT uses "skip"
            /// - but both should return the same result
            ///
            /// -5632                0                   5632                 11264
            ///                          p2----p2：5_000_000
            ///           p1----p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///       c1-------------------->c2
            fn tick_index_neg_4224_b_to_a_crossing_large_liquidity_zero_range() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -4224,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p1
                            index: -2816,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: -1408,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: 5_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 2816,
                            liquidity_net: -5_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [
                        (-2816, 1_000_000),
                        (-1408, -1_000_000),
                        (1408, 5_000_000),
                        (2816, -5_000_000),
                    ]
                    .into_iter()
                    .collect(),
                    -4224 + 64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -66,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 5_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, zero liquidity range: [1344, 1408]
            /// notes:
            /// - swap_test_info.run (swap loop implementation) uses "skip"
            /// - get_expected_result does NOT uses "skip"
            /// - but both should return the same result
            ///
            /// -5632                0                   5632                 11264
            ///                          p2----p2：5_000_000
            ///           p1------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///       c1-------------------->c2
            fn tick_index_neg_4224_b_to_a_crossing_minimum_liquidity_zero_range() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -4224,
                    start_tick_index: -5632,
                    trade_amount: 500_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p1
                            index: 1344,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: 5_000_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 2816,
                            liquidity_net: -5_000_000,
                            ..Default::default()
                        },
                    ]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [
                        (-2816, 1_000_000),
                        (1344, -1_000_000),
                        (1408, 5_000_000),
                        (2816, -5_000_000),
                    ]
                    .into_iter()
                    .collect(),
                    -4224 + 64,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -66,
                    1_000_000,
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 5_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }
        }

        mod ts_32896_with_zero_liquidity_skip {
            use super::*;

            const TS: u16 = 32896; // 2^15 + 128 (ts for Full range only pool (aka SplashPool))
            const TICK_GROUP_SIZE: u16 = 128; // TS is too large

            fn adaptive_fee_info_without_max_volatility_skip() -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 5_000,
                        reduction_factor: 500,
                        // block skip based on max_volatility_accumulator
                        max_volatility_accumulator: 88 * 3 * 10_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, max to min
            /// notes:
            /// SplashPool allows Full Range positions only.
            /// So zero liquidity range means that pool has no liquidity at all.
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///                       NO LIQUIDITY
            /// |--------------------------|--------------------------|
            ///              c2<------------------------c1
            fn from_max_sqrt_price_to_min_sqrt_price_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: MAX_TICK_INDEX,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![],
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: 0,
                        traded_amount_b: 0,
                        end_tick_index: MIN_TICK_INDEX - 1, // shifted
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, 0);
                println!("after afv: {:?}", post_swap.next_adaptive_fee_info);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: 3465, // tick_group_index for 443636
                        // pool price moved MAX_TICK_INDEX to MIN_TICK_INDEX, max volatility is expected
                        volatility_accumulator: adaptive_fee_info
                            .unwrap()
                            .constants
                            .max_volatility_accumulator,
                        ..Default::default()
                    },
                );
            }

            #[test]
            /// b to a, min to max
            /// notes:
            /// SplashPool allows Full Range positions only.
            /// So zero liquidity range means that pool has no liquidity at all.
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///                       NO LIQUIDITY
            /// |--------------------------|--------------------------|
            ///              c2------------------------>c1
            fn from_min_sqrt_price_to_max_sqrt_price_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: MIN_TICK_INDEX,
                    start_tick_index: -2894848,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![],
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: 0,
                        traded_amount_b: 0,
                        end_tick_index: MAX_TICK_INDEX,
                        end_liquidity: 0,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, 0);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: -3466, // tick_group_index for -443636
                        // pool price moved MIN_TICK_INDEX to MAX_TICK_INDEX, max volatility is expected
                        volatility_accumulator: adaptive_fee_info
                            .unwrap()
                            .constants
                            .max_volatility_accumulator,
                            ..Default::default()
                    },
                );
            }
        }

        mod ts_64_with_zero_adaptive_fee_control_factor {
            use super::*;

            const TS: u16 = 64;
            const TICK_GROUP_SIZE: u16 = TS;

            fn adaptive_fee_info_with_zero_adaptive_fee_control_factor() -> Option<AdaptiveFeeInfo>
            {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 60,
                        adaptive_fee_control_factor: 0, // virtually, no adaptive fee
                        reduction_factor: 0,
                        max_volatility_accumulator: 350_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, its result should be same to no adaptive fee case
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                  c2<------c1
            fn tick_index_0_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_with_zero_adaptive_fee_control_factor();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info_with_adaptive_fee = SwapTestFixture::new(SwapTestFixtureInfo {
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let swap_test_info_without_adaptive_fee =
                    SwapTestFixture::new(SwapTestFixtureInfo {
                        adaptive_fee_info: None,
                        tick_spacing: TS,
                        liquidity: 1_000_000 + 500_000,
                        curr_tick_index: 0,
                        start_tick_index: 0,
                        trade_amount: 150_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p2
                                index: 0,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 1408,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 2816,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: -2816,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        }]),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                let mut tick_sequence_without_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_without_adaptive_fee.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_without_adaptive_fee.tick_arrays[1].borrow_mut()),
                    None,
                );
                let expected = swap_test_info_without_adaptive_fee
                    .run(&mut tick_sequence_without_adaptive_fee, 1_000_000);

                let mut tick_sequence_with_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_with_adaptive_fee.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_with_adaptive_fee.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info_with_adaptive_fee
                    .run(&mut tick_sequence_with_adaptive_fee, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_with_adaptive_fee.trade_amount,
                        traded_amount_b: expected.amount_b,
                        end_tick_index: expected.next_tick_index,
                        end_liquidity: expected.next_liquidity,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.amount_a, expected.amount_a);
                assert_eq!(post_swap.next_protocol_fee, expected.next_protocol_fee);

                assert!(floor_division(post_swap.next_tick_index, TICK_GROUP_SIZE as i32) < -35);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: 0, // tick_group_index for 0
                        // volatility accumulator should be updated correctly even if adaptive fee control factor is zero
                        volatility_accumulator: adaptive_fee_info
                            .unwrap()
                            .constants
                            .max_volatility_accumulator,
                            ..Default::default()
                    },
                );
            }

            #[test]
            /// b to a, its result should be same to no adaptive fee case
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                      c1----->c2
            fn tick_index_0_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_with_zero_adaptive_fee_control_factor();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info_with_adaptive_fee = SwapTestFixture::new(SwapTestFixtureInfo {
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    tick_spacing: TS,
                    liquidity: 1_000_000 + 500_000,
                    curr_tick_index: 0,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let swap_test_info_without_adaptive_fee =
                    SwapTestFixture::new(SwapTestFixtureInfo {
                        adaptive_fee_info: None,
                        tick_spacing: TS,
                        liquidity: 1_000_000 + 500_000,
                        curr_tick_index: 0,
                        start_tick_index: -5632,
                        trade_amount: 150_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![TestTickInfo {
                            // p1
                            index: -2816,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        }],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p2
                                index: 0,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 1408,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 2816,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                let mut tick_sequence_without_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_without_adaptive_fee.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info_without_adaptive_fee.tick_arrays[2].borrow_mut()),
                    None,
                );
                let expected = swap_test_info_without_adaptive_fee
                    .run(&mut tick_sequence_without_adaptive_fee, 1_000_000);

                let mut tick_sequence_with_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_with_adaptive_fee.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info_with_adaptive_fee.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info_with_adaptive_fee
                    .run(&mut tick_sequence_with_adaptive_fee, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.amount_a,
                        traded_amount_b: swap_test_info_with_adaptive_fee.trade_amount,
                        end_tick_index: expected.next_tick_index,
                        end_liquidity: expected.next_liquidity,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.amount_b, expected.amount_b);
                assert_eq!(post_swap.next_protocol_fee, expected.next_protocol_fee);

                assert!(floor_division(post_swap.next_tick_index, TICK_GROUP_SIZE as i32) == 33);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: 0, // tick_group_index for 0
                        // volatility accumulator should be updated correctly even if adaptive fee control factor is zero
                        volatility_accumulator: 330_000,
                        ..Default::default()
                    },
                );
            }

            #[test]
            /// a to b, its result should be same to no adaptive fee case (shifted)
            ///
            /// -11264               -5632                0                   5632
            ///                                           p2---p2：500_000
            ///                                p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|
            ///                                  c2<------c1
            fn tick_index_0_shifted_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_with_zero_adaptive_fee_control_factor();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info_with_adaptive_fee = SwapTestFixture::new(SwapTestFixtureInfo {
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let swap_test_info_without_adaptive_fee =
                    SwapTestFixture::new(SwapTestFixtureInfo {
                        adaptive_fee_info: None,
                        tick_spacing: TS,
                        liquidity: 1_000_000,
                        curr_tick_index: -1, // shifted
                        curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                        start_tick_index: 0,
                        trade_amount: 150_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p2
                                index: 0,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 1408,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 2816,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: -2816,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        }]),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                let mut tick_sequence_without_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_without_adaptive_fee.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let expected = swap_test_info_without_adaptive_fee
                    .run(&mut tick_sequence_without_adaptive_fee, 1_000_000);

                let mut tick_sequence_with_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_with_adaptive_fee.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap = swap_test_info_with_adaptive_fee
                    .run(&mut tick_sequence_with_adaptive_fee, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_with_adaptive_fee.trade_amount,
                        traded_amount_b: expected.amount_b,
                        end_tick_index: expected.next_tick_index,
                        end_liquidity: expected.next_liquidity,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.amount_a, expected.amount_a);
                assert_eq!(post_swap.next_protocol_fee, expected.next_protocol_fee);

                assert!(floor_division(post_swap.next_tick_index, TICK_GROUP_SIZE as i32) < -36);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: -1, // tick_group_index for -1 (shifted)
                        // volatility accumulator should be updated correctly even if adaptive fee control factor is zero
                        volatility_accumulator: adaptive_fee_info
                            .unwrap()
                            .constants
                            .max_volatility_accumulator,
                        ..Default::default()
                    },
                );
            }

            #[test]
            /// b to a, its result should be same to no adaptive fee case (shifted)
            ///
            /// -5632                0                   5632                 11264
            ///                      p2---p2：500_000
            ///          p1---------------------p1: 1_000_000
            /// |--------------------|--------------------|--------------------|--------------------|
            ///                      c1----->c2
            fn tick_index_0_shifted_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_with_zero_adaptive_fee_control_factor();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info_with_adaptive_fee = SwapTestFixture::new(SwapTestFixtureInfo {
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -1, // shifted
                    curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -2816,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![
                        TestTickInfo {
                            // p2
                            index: 0,
                            liquidity_net: 500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p2
                            index: 1408,
                            liquidity_net: -500_000,
                            ..Default::default()
                        },
                        TestTickInfo {
                            // p1
                            index: 2816,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        },
                    ]),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let swap_test_info_without_adaptive_fee =
                    SwapTestFixture::new(SwapTestFixtureInfo {
                        adaptive_fee_info: None,
                        tick_spacing: TS,
                        liquidity: 1_000_000,
                        curr_tick_index: -1, // shifted
                        curr_sqrt_price_override: Some(sqrt_price_from_tick_index(0)),
                        start_tick_index: -5632,
                        trade_amount: 150_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![TestTickInfo {
                            // p1
                            index: -2816,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        }],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p2
                                index: 0,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 1408,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 2816,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                let mut tick_sequence_without_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_without_adaptive_fee.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info_without_adaptive_fee.tick_arrays[2].borrow_mut()),
                    None,
                );
                let expected = swap_test_info_without_adaptive_fee
                    .run(&mut tick_sequence_without_adaptive_fee, 1_000_000);

                let mut tick_sequence_with_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_with_adaptive_fee.tick_arrays[1].borrow_mut(),
                    Some(swap_test_info_with_adaptive_fee.tick_arrays[2].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info_with_adaptive_fee
                    .run(&mut tick_sequence_with_adaptive_fee, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.amount_a,
                        traded_amount_b: swap_test_info_with_adaptive_fee.trade_amount,
                        end_tick_index: expected.next_tick_index,
                        end_liquidity: expected.next_liquidity,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.amount_b, expected.amount_b);
                assert_eq!(post_swap.next_protocol_fee, expected.next_protocol_fee);

                assert!(floor_division(post_swap.next_tick_index, TICK_GROUP_SIZE as i32) == 33);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: -1, // tick_group_index for -1 (shifted)
                        // volatility accumulator should be updated correctly even if adaptive fee control factor is zero
                        volatility_accumulator: 340_000, // -1 -> 33
                        ..Default::default()
                    },
                );
            }
        }

        mod ts_32896_with_zero_adaptive_fee_control_factor {
            use super::*;

            const TS: u16 = 32896; // 2^15 + 128 (ts for Full range only pool (aka SplashPool))
            const TICK_GROUP_SIZE: u16 = 128; // TS is too large

            fn adaptive_fee_info_with_zero_adaptive_fee_control_factor() -> Option<AdaptiveFeeInfo>
            {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 60,
                        adaptive_fee_control_factor: 0, // virtually, no adaptive fee
                        reduction_factor: 0,
                        max_volatility_accumulator: 350_000,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, its result should be same to no adaptive fee case
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                    c2<------c1
            fn tick_index_128_a_to_b() {
                let adaptive_fee_info = adaptive_fee_info_with_zero_adaptive_fee_control_factor();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info_with_adaptive_fee = SwapTestFixture::new(SwapTestFixtureInfo {
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 128,
                    start_tick_index: 0,
                    trade_amount: 10_000_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let swap_test_info_without_adaptive_fee =
                    SwapTestFixture::new(SwapTestFixtureInfo {
                        adaptive_fee_info: None,
                        tick_spacing: TS,
                        liquidity: 1_000_000,
                        curr_tick_index: 128,
                        start_tick_index: 0,
                        trade_amount: 10_000_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![TestTickInfo {
                            // p1
                            index: 427648,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        }],
                        array_2_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: -427648,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        }]),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                let mut tick_sequence_without_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_without_adaptive_fee.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_without_adaptive_fee.tick_arrays[1].borrow_mut()),
                    None,
                );
                let expected = swap_test_info_without_adaptive_fee
                    .run(&mut tick_sequence_without_adaptive_fee, 1_000_000);

                let mut tick_sequence_with_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_with_adaptive_fee.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_with_adaptive_fee.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info_with_adaptive_fee
                    .run(&mut tick_sequence_with_adaptive_fee, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_with_adaptive_fee.trade_amount,
                        traded_amount_b: expected.amount_b,
                        end_tick_index: expected.next_tick_index,
                        end_liquidity: expected.next_liquidity,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.amount_a, expected.amount_a);
                assert_eq!(post_swap.next_protocol_fee, expected.next_protocol_fee);

                assert!(floor_division(post_swap.next_tick_index, TICK_GROUP_SIZE as i32) < -35);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: 1, // tick_group_index for 128
                        // volatility accumulator should be updated correctly even if adaptive fee control factor is zero
                        volatility_accumulator: adaptive_fee_info
                            .unwrap()
                            .constants
                            .max_volatility_accumulator,
                        ..Default::default()
                    },
                );
            }

            #[test]
            /// b to a, its result should be same to no adaptive fee case
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                           c1----->c2
            fn tick_index_neg_128_b_to_a() {
                let adaptive_fee_info = adaptive_fee_info_with_zero_adaptive_fee_control_factor();
                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info_with_adaptive_fee = SwapTestFixture::new(SwapTestFixtureInfo {
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: -128,
                    start_tick_index: -2894848,
                    trade_amount: 10_000_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let swap_test_info_without_adaptive_fee =
                    SwapTestFixture::new(SwapTestFixtureInfo {
                        adaptive_fee_info: None,
                        tick_spacing: TS,
                        liquidity: 1_000_000,
                        curr_tick_index: -128,
                        start_tick_index: -2894848,
                        trade_amount: 10_000_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![TestTickInfo {
                            // p1
                            index: -427648,
                            liquidity_net: 1_000_000,
                            ..Default::default()
                        }],
                        array_2_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: 427648,
                            liquidity_net: -1_000_000,
                            ..Default::default()
                        }]),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                let mut tick_sequence_without_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_without_adaptive_fee.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let expected = swap_test_info_without_adaptive_fee
                    .run(&mut tick_sequence_without_adaptive_fee, 1_000_000);

                let mut tick_sequence_with_adaptive_fee = SwapTickSequence::new(
                    swap_test_info_with_adaptive_fee.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap = swap_test_info_with_adaptive_fee
                    .run(&mut tick_sequence_with_adaptive_fee, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.amount_a,
                        traded_amount_b: swap_test_info_with_adaptive_fee.trade_amount,
                        end_tick_index: expected.next_tick_index,
                        end_liquidity: expected.next_liquidity,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.amount_b, expected.amount_b);
                assert_eq!(post_swap.next_protocol_fee, expected.next_protocol_fee);

                assert!(floor_division(post_swap.next_tick_index, TICK_GROUP_SIZE as i32) > 35);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 1_000_000,
                        volatility_reference: 0,
                        tick_group_index_reference: -1, // tick_group_index for -128
                        // volatility accumulator should be updated correctly even if adaptive fee control factor is zero
                        volatility_accumulator: adaptive_fee_info
                            .unwrap()
                            .constants
                            .max_volatility_accumulator,
                        ..Default::default()
                    },
                );
            }
        }

        mod ts_64_with_max_volatility_skip {
            use super::*;

            const TS: u16 = 64;
            const TICK_GROUP_SIZE: u16 = TS;

            fn adaptive_fee_info_with_max_volatility_skip(
                max_volatility_accumulator: u32,
            ) -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 5_000,
                        reduction_factor: 500,
                        max_volatility_accumulator,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            mod ref_zero {
                use super::*;
                #[test]
                /// a to b, core range to skip range, step by step + skip
                ///
                /// -11264               -5632                0                   5632
                ///                                        p3---p3: 200_000
                ///                                  p2---------------p2：500_000
                ///                         p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|
                ///                            c2<********----c1 (*: skip enabled)
                fn a_to_b_core_range_to_skip_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 1_000_000 + 500_000 + 200_000,
                        curr_tick_index: 0,
                        start_tick_index: 0,
                        trade_amount: 300_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    //let af_constants = adaptive_fee_info.as_ref().unwrap().constants;
                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [(-256, 200_000), (-2816, 500_000), (-4224, 1_000_000)]
                            .into_iter()
                            .collect(),
                        0,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        0,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p2 end
                            (-8 - 1, -2816),
                            // skip to p1 end
                            (-2816 / TICK_GROUP_SIZE as i32 - 1, -4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: swap_test_info.trade_amount,
                            traded_amount_b: expected.output_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );
                }

                #[test]
                /// b to a, core range to skip range, step by step + skip
                ///
                /// -5632                0                   5632                 11264
                ///                   p3---p3: 200_000
                ///            p2---------------p2：500_000
                ///    p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|--------------------|
                ///                      c1--*********>c2 (*: skip enabled)
                fn b_to_a_core_range_to_skip_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 1_000_000 + 500_000 + 200_000,
                        curr_tick_index: 0,
                        start_tick_index: -5632,
                        trade_amount: 300_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [(256, -200_000), (2816, -500_000), (4224, -1_000_000)]
                            .into_iter()
                            .collect(),
                        64,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        0,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p2 end
                            (8 + 1, 2816),
                            // skip to p1 end
                            (2816 / TICK_GROUP_SIZE as i32, 4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[1].borrow_mut(),
                        Some(swap_test_info.tick_arrays[2].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.output_amount,
                            traded_amount_b: swap_test_info.trade_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );
                }

                #[test]
                /// a to b, skip range only
                ///
                /// -11264               -5632                0                   5632
                ///                                        p3---p3: 200_000
                ///                                  p2---------------p2：500_000
                ///                         p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|
                ///                            c2<******c1 (*: skip enabled)
                fn a_to_b_skip_range_only() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let mut adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 0 as reference tick group index
                    // test will start with max volatility accumulator
                    adaptive_fee_info
                        .variables
                        .update_reference(0, 1_000_000, &adaptive_fee_info.constants)
                        .unwrap();
                    adaptive_fee_info
                        .variables
                        .update_volatility_accumulator(-10, &adaptive_fee_info.constants)
                        .unwrap();
                    check_next_adaptive_fee_variables(
                        &adaptive_fee_info.variables,
                        &AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 0,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    );
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: adaptive_fee_info.variables,
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 1_000_000 + 500_000,
                        curr_tick_index: -640,
                        start_tick_index: 0,
                        trade_amount: 200_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [(-2816, 500_000), (-4224, 1_000_000)].into_iter().collect(),
                        -640,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        -10,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p2 end
                            (-10, -2816),
                            // skip to p1 end
                            (-2816 / TICK_GROUP_SIZE as i32 - 1, -4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[1].borrow_mut(),
                        None,
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: swap_test_info.trade_amount,
                            traded_amount_b: expected.output_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );
                }

                #[test]
                /// b to a, skip range only
                ///
                /// -5632                0                   5632                 11264
                ///                   p3---p3: 200_000
                ///            p2---------------p2：500_000
                ///    p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|--------------------|
                ///                         c1********>c2 (*: skip enabled)
                fn b_to_a_skip_range_only() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let mut adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 0 as reference tick group index
                    // test will start with max volatility accumulator
                    adaptive_fee_info
                        .variables
                        .update_reference(0, 1_000_000, &adaptive_fee_info.constants)
                        .unwrap();
                    adaptive_fee_info
                        .variables
                        .update_volatility_accumulator(10, &adaptive_fee_info.constants)
                        .unwrap();
                    check_next_adaptive_fee_variables(
                        &adaptive_fee_info.variables,
                        &AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 0,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    );
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: adaptive_fee_info.variables,
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 1_000_000 + 500_000,
                        curr_tick_index: 640,
                        start_tick_index: -5632,
                        trade_amount: 200_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [(2816, -500_000), (4224, -1_000_000)].into_iter().collect(),
                        640 + 64,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        10,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p2 end
                            (10, 2816),
                            // skip to p1 end
                            (2816 / TICK_GROUP_SIZE as i32, 4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[1].borrow_mut(),
                        Some(swap_test_info.tick_arrays[2].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.output_amount,
                            traded_amount_b: swap_test_info.trade_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );
                }

                #[test]
                /// b to a, skip range to core range, skip + step by step
                ///
                /// -5632                0                   5632                 11264
                ///                   p3---p3: 200_000
                ///            p2---------------p2：500_000
                ///    p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|--------------------|
                ///  c1**************------->c2 (*: skip enabled)
                fn b_to_a_skip_range_to_core_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let mut adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 0 as reference tick group index
                    // test will start with max volatility accumulator
                    adaptive_fee_info
                        .variables
                        .update_reference(0, 1_000_000, &adaptive_fee_info.constants)
                        .unwrap();
                    adaptive_fee_info
                        .variables
                        .update_volatility_accumulator(-70, &adaptive_fee_info.constants)
                        .unwrap();
                    check_next_adaptive_fee_variables(
                        &adaptive_fee_info.variables,
                        &AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 0,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    );
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: adaptive_fee_info.variables,
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: -4480,
                        start_tick_index: -5632,
                        trade_amount: 300_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [
                            (-4224, 1_000_000),
                            (-2816, 500_000),
                            (-256, 200_000),
                            (256, -200_000),
                            (2816, -500_000),
                            (4224, -1_000_000),
                        ]
                        .into_iter()
                        .collect(),
                        -4480 + 64,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        -70,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p1 left end
                            (-70, -4224),
                            // skip to p2 left end
                            (-4224 / TICK_GROUP_SIZE as i32, -2816),
                            // skip to core range lower end
                            (-2816 / TICK_GROUP_SIZE as i32, -512),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.output_amount,
                            traded_amount_b: swap_test_info.trade_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000 + 500_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> not max (core range)
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            < max_volatility_accumulator
                    );
                }

                #[test]
                /// b to a, skip range to core range to skip range, skip + step by step + skip
                ///
                /// -5632                0                   5632                 11264
                ///                   p3---p3: 200_000
                ///            p2---------------p2：500_000
                ///    p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|--------------------|
                ///  c1**************---------********>c2 (*: skip enabled)
                fn b_to_a_skip_range_to_core_range_to_skip_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let mut adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 0 as reference tick group index
                    // test will start with max volatility accumulator
                    adaptive_fee_info
                        .variables
                        .update_reference(0, 1_000_000, &adaptive_fee_info.constants)
                        .unwrap();
                    adaptive_fee_info
                        .variables
                        .update_volatility_accumulator(-70, &adaptive_fee_info.constants)
                        .unwrap();
                    check_next_adaptive_fee_variables(
                        &adaptive_fee_info.variables,
                        &AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 0,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    );
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: adaptive_fee_info.variables,
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: -4480,
                        start_tick_index: -5632,
                        trade_amount: 500_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [
                            (-4224, 1_000_000),
                            (-2816, 500_000),
                            (-256, 200_000),
                            (256, -200_000),
                            (2816, -500_000),
                            (4224, -1_000_000),
                        ]
                        .into_iter()
                        .collect(),
                        -4480 + 64,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        -70,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p1 left end
                            (-70, -4224),
                            // skip to p2 left end
                            (-4224 / TICK_GROUP_SIZE as i32, -2816),
                            // skip to core range lower end
                            (-2816 / TICK_GROUP_SIZE as i32, -512),
                            // skip to p2 right end
                            (8 + 1, 2816),
                            // skip to p1 right end
                            (2816 / TICK_GROUP_SIZE as i32, 4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.output_amount,
                            traded_amount_b: swap_test_info.trade_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> max again
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            == max_volatility_accumulator
                    );
                }

                #[test]
                /// a to b, skip range to core range, skip + step by step
                ///
                /// -11264               -5632                0                   5632
                ///                                        p3---p3: 200_000
                ///                                  p2---------------p2：500_000
                ///                         p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|
                ///                                     c2<--------**************c1 (*: skip enabled)
                fn a_to_b_skip_range_to_core_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let mut adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 0 as reference tick group index
                    // test will start with max volatility accumulator
                    adaptive_fee_info
                        .variables
                        .update_reference(0, 1_000_000, &adaptive_fee_info.constants)
                        .unwrap();
                    adaptive_fee_info
                        .variables
                        .update_volatility_accumulator(70, &adaptive_fee_info.constants)
                        .unwrap();
                    check_next_adaptive_fee_variables(
                        &adaptive_fee_info.variables,
                        &AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 0,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    );
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: adaptive_fee_info.variables,
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: 4480,
                        start_tick_index: 0,
                        trade_amount: 280_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [
                            (4224, -1_000_000),
                            (2816, -500_000),
                            (256, -200_000),
                            (-256, 200_000),
                            (-2816, 500_000),
                            (-4224, 1_000_000),
                        ]
                        .into_iter()
                        .collect(),
                        4480,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        70,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p1 right end
                            (70, 4224),
                            // skip to p2 right end
                            (4224 / TICK_GROUP_SIZE as i32 - 1, 2816),
                            // skip to core range upper end
                            (2816 / TICK_GROUP_SIZE as i32 - 1, 512 + 64),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: swap_test_info.trade_amount,
                            traded_amount_b: expected.output_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000 + 500_000 + 200_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> not max (core range)
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            < max_volatility_accumulator
                    );
                }

                #[test]
                /// a to b, skip range to core range to skip range, skip + step by step + skip
                ///
                /// -11264               -5632                0                   5632
                ///                                        p3---p3: 200_000
                ///                                  p2---------------p2：500_000
                ///                         p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|
                ///                            c2<*******----------**************c1 (*: skip enabled)
                fn a_to_b_skip_range_to_core_range_to_skip_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let mut adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 0 as reference tick group index
                    // test will start with max volatility accumulator
                    adaptive_fee_info
                        .variables
                        .update_reference(0, 1_000_000, &adaptive_fee_info.constants)
                        .unwrap();
                    adaptive_fee_info
                        .variables
                        .update_volatility_accumulator(70, &adaptive_fee_info.constants)
                        .unwrap();
                    check_next_adaptive_fee_variables(
                        &adaptive_fee_info.variables,
                        &AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 0,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    );
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: adaptive_fee_info.variables,
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: 4480,
                        start_tick_index: 0,
                        trade_amount: 500_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [
                            (4224, -1_000_000),
                            (2816, -500_000),
                            (256, -200_000),
                            (-256, 200_000),
                            (-2816, 500_000),
                            (-4224, 1_000_000),
                        ]
                        .into_iter()
                        .collect(),
                        4480,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        70,
                        1_000_000,
                        [
                            // core tick group range: [-8, +8]
                            // skip to p1 right end
                            (70, 4224),
                            // skip to p2 right end
                            (4224 / TICK_GROUP_SIZE as i32 - 1, 2816),
                            // skip to core range upper end
                            (2816 / TICK_GROUP_SIZE as i32 - 1, 512 + 64),
                            // skip to p2 left end
                            (-8 - 1, -2816),
                            // skip to p1 end
                            (-2816 / TICK_GROUP_SIZE as i32 - 1, -4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: swap_test_info.trade_amount,
                            traded_amount_b: expected.output_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> max again
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            == max_volatility_accumulator
                    );
                }
            }

            mod ref_not_zero {
                use super::*;

                #[test]
                /// a to b, skip range to core range to skip range, skip + step by step + skip
                /// notes:
                /// - tick_group_index_reference: 20
                /// - volatility_reference: 15000
                ///
                /// -11264               -5632                0                   5632
                ///                                        p3---p3: 200_000
                ///                                  p2---------------p2：500_000
                ///                         p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|
                ///                            c2<*****************--************c1 (*: skip enabled)
                fn a_to_b_skip_range_to_core_range_to_skip_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 20 as reference tick group index
                    // set 10000 as reference volatility
                    // test will start with max volatility accumulator
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 20,
                            volatility_reference: 15_000,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: 4480,
                        start_tick_index: 0,
                        trade_amount: 500_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [
                            (4224, -1_000_000),
                            (2816, -500_000),
                            (256, -200_000),
                            (-256, 200_000),
                            (-2816, 500_000),
                            (-4224, 1_000_000),
                        ]
                        .into_iter()
                        .collect(),
                        4480,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        70,
                        1_000_000,
                        [
                            // core tick group range: [13, 27] (20 - 7, 20 + 7)
                            // skip to p1 right end
                            (70, 4224),
                            // skip to p2 right end
                            (4224 / TICK_GROUP_SIZE as i32 - 1, 2816),
                            // skip to core range upper end
                            (2816 / TICK_GROUP_SIZE as i32 - 1, 1728 + 64),
                            // skip to p3 right end
                            (13 - 1, 256),
                            // skip to p3 left end
                            (256 / TICK_GROUP_SIZE as i32 - 1, -256),
                            // skip to p2 left end
                            (-256 / TICK_GROUP_SIZE as i32 - 1, -2816),
                            // skip to p1 end
                            (-2816 / TICK_GROUP_SIZE as i32 - 1, -4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: swap_test_info.trade_amount,
                            traded_amount_b: expected.output_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> max again
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            == max_volatility_accumulator
                    );
                }

                #[test]
                /// b to a, skip range to core range to skip range, skip + step by step + skip
                /// notes:
                /// - tick_group_index_reference: 20
                /// - volatility_reference: 15000
                ///
                /// -5632                0                   5632                 11264
                ///                   p3---p3: 200_000
                ///            p2---------------p2：500_000
                ///    p1---------------------------------p1: 1_000_000
                /// |--------------------|--------------------|--------------------|--------------------|
                ///  c1**********************--********>c2 (*: skip enabled)
                fn b_to_a_skip_range_to_core_range_to_skip_range() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 20 as reference tick group index
                    // set 10000 as reference volatility
                    // test will start with max volatility accumulator
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 20,
                            volatility_reference: 15_000,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: -4480,
                        start_tick_index: -5632,
                        trade_amount: 500_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![
                            TestTickInfo {
                                // p3
                                index: -256,
                                liquidity_net: 200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: -2816,
                                liquidity_net: 500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: -4224,
                                liquidity_net: 1_000_000,
                                ..Default::default()
                            },
                        ],
                        array_2_ticks: Some(&vec![
                            TestTickInfo {
                                // p3
                                index: 256,
                                liquidity_net: -200_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p2
                                index: 2816,
                                liquidity_net: -500_000,
                                ..Default::default()
                            },
                            TestTickInfo {
                                // p1
                                index: 4224,
                                liquidity_net: -1_000_000,
                                ..Default::default()
                            },
                        ]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [
                            (-4224, 1_000_000),
                            (-2816, 500_000),
                            (-256, 200_000),
                            (256, -200_000),
                            (2816, -500_000),
                            (4224, -1_000_000),
                        ]
                        .into_iter()
                        .collect(),
                        -4480 + 64,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        -70,
                        1_000_000,
                        [
                            // core tick group range: [13, 27] (20 - 7, 20 + 7)
                            // skip to p1 left end
                            (-70, -4224),
                            // skip to p2 left end
                            (-4224 / TICK_GROUP_SIZE as i32, -2816),
                            // skip to p1 left end
                            (-2816 / TICK_GROUP_SIZE as i32, -256),
                            // skip to p1 right end
                            (-256 / TICK_GROUP_SIZE as i32, 256),
                            // skip to core range lower end
                            (256 / TICK_GROUP_SIZE as i32, 832),
                            // skip to p2 right end
                            (27 + 1, 2816),
                            // skip to p1 right end
                            (2816 / TICK_GROUP_SIZE as i32, 4224),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.output_amount,
                            traded_amount_b: swap_test_info.trade_amount,
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 1_000_000,
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> max again
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            == max_volatility_accumulator
                    );
                }

                #[test]
                /// a to b, skip range to core range and hit MIN_SQRT_PRICE
                ///
                /// -444928     -443584  -439296              -433664
                ///             p1-----------------p1: 1000
                /// |--------------------|--------------------|--------------------|
                /// (-443636) c2<----*************************c1
                fn a_to_b_skip_range_to_core_range_to_min_sqrt_price() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set -6929 as reference tick group index
                    // test will start with max volatility accumulator
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: -6929,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let p1_liquidity = 1_000i128;

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: -433664,
                        start_tick_index: -433664,
                        trade_amount: 1_500_000_000_000,
                        sqrt_price_limit: 0,
                        amount_specified_is_input: true,
                        a_to_b: A_TO_B,
                        array_1_ticks: &vec![],
                        array_2_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: -439296 + 2816,
                            liquidity_net: -p1_liquidity,
                            ..Default::default()
                        }]),
                        array_3_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: -443584,
                            liquidity_net: p1_liquidity,
                            ..Default::default()
                        }]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [(-439296 + 2816, -p1_liquidity), (-443584, p1_liquidity)]
                            .into_iter()
                            .collect(),
                        -433664,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        -6776,
                        1_000_000,
                        [
                            // core tick group range: [-6937, -6921] (-6929 - 8, -6929 + 8)
                            // skip to p1 right end
                            (-6776, -436480),
                            // skip to core range upper end
                            (-436480 / TICK_GROUP_SIZE as i32 - 1, -442880),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[0].borrow_mut(),
                        Some(swap_test_info.tick_arrays[1].borrow_mut()),
                        Some(swap_test_info.tick_arrays[2].borrow_mut()),
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.input_amount, // partial fill
                            traded_amount_b: expected.output_amount,
                            end_tick_index: -443636 - 1, // shifted
                            end_liquidity: 0,            // no liquidity at MIN_SQRT_PRICE
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> not max (core range)
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            < max_volatility_accumulator
                    );
                }

                #[test]
                /// b to a, skip range to core range and hit MAX_SQRT_PRICE
                ///
                /// 428032               433664               439296    443584 (full range index)
                ///                               p1---------------------p1: 100
                /// |--------------------|--------------------|--------------------|
                ///                      c1***************************------>c2 (443636)
                fn b_to_a_skip_range_to_core_range_to_max_sqrt_price() {
                    // reach max by 8 delta tick_group_index
                    let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                    let adaptive_fee_info =
                        adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator)
                            .unwrap();

                    // set 6929 as reference tick group index
                    // test will start with max volatility accumulator
                    let adaptive_fee_info = Some(AdaptiveFeeInfo {
                        constants: adaptive_fee_info.constants,
                        variables: AdaptiveFeeVariables {
                            last_reference_update_timestamp: 1_000_000,
                            last_major_swap_timestamp: 0,
                            tick_group_index_reference: 6929,
                            volatility_reference: 0,
                            volatility_accumulator: adaptive_fee_info
                                .constants
                                .max_volatility_accumulator,
                            ..Default::default()
                        },
                    });

                    let static_fee_rate = 1000; // 0.1%
                    let protocol_fee_rate = 100; // 1%

                    let p1_liquidity = 100i128;

                    let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                        tick_spacing: TS,
                        liquidity: 0,
                        curr_tick_index: 433664,
                        start_tick_index: 428032,
                        trade_amount: 1_500_000_000_000,
                        sqrt_price_limit: MAX_SQRT_PRICE_X64,
                        amount_specified_is_input: true,
                        a_to_b: B_TO_A,
                        array_1_ticks: &vec![],
                        array_2_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: 439296 - 2816,
                            liquidity_net: p1_liquidity,
                            ..Default::default()
                        }]),
                        array_3_ticks: Some(&vec![TestTickInfo {
                            // p1
                            index: 443584,
                            liquidity_net: -p1_liquidity,
                            ..Default::default()
                        }]),
                        adaptive_fee_info: adaptive_fee_info.clone(),
                        fee_rate: static_fee_rate,
                        protocol_fee_rate,
                        ..Default::default()
                    });

                    let expected = get_expected_result_with_max_volatility_skip(
                        swap_test_info.a_to_b,
                        swap_test_info.whirlpool.sqrt_price,
                        swap_test_info.whirlpool.liquidity,
                        [(439296 - 2816, p1_liquidity), (443584, -p1_liquidity)]
                            .into_iter()
                            .collect(),
                        433664 + 64,
                        swap_test_info.trade_amount,
                        static_fee_rate,
                        protocol_fee_rate,
                        adaptive_fee_info.clone().unwrap(),
                        6776,
                        1_000_000,
                        [
                            // core tick group range: [6921, 6937] (6929 - 8, 6929 + 8)
                            // skip to p1 left end
                            (6776, 436480),
                            // skip to core range lower end
                            (436480 / TICK_GROUP_SIZE as i32, 442944),
                        ]
                        .into_iter()
                        .collect(),
                    );

                    let mut tick_sequence = SwapTickSequence::new(
                        swap_test_info.tick_arrays[1].borrow_mut(),
                        Some(swap_test_info.tick_arrays[2].borrow_mut()),
                        None,
                    );
                    let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                    println!("result: {:?}", post_swap);
                    println!("expect: {:?}", expected);

                    assert_swap(
                        &post_swap,
                        &SwapTestExpectation {
                            traded_amount_a: expected.output_amount,
                            traded_amount_b: expected.input_amount, // partial fill
                            end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                            end_liquidity: 0, // no liquidity at MAX_SQRT_PRICE
                            end_reward_growths: [0, 0, 0],
                        },
                    );
                    assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                    assert_eq!(expected.end_sqrt_price, MAX_SQRT_PRICE_X64);
                    check_next_adaptive_fee_variables(
                        &post_swap.next_adaptive_fee_info.unwrap().variables,
                        &expected.next_adaptive_fee_variables,
                    );

                    // max -> 0 -> not max (core range)
                    assert!(
                        expected.next_adaptive_fee_variables.volatility_accumulator
                            < max_volatility_accumulator
                    );
                }
            }
        }

        mod ts_32896_with_max_volatility_skip {
            use super::*;

            const TS: u16 = 32896;
            const TICK_GROUP_SIZE: u16 = 128;

            fn adaptive_fee_info_with_max_volatility_skip(
                max_volatility_accumulator: u32,
            ) -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 1_000,
                        reduction_factor: 500,
                        max_volatility_accumulator,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, core range to skip range, step by step + skip
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                   c2<****--c1 (*: skip enabled)
            fn a_to_b_core_range_to_skip_range() {
                // reach max by 35 delta tick_group_index
                let max_volatility_accumulator = 35 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 0,
                    start_tick_index: 0,
                    trade_amount: 1_000_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result_with_max_volatility_skip(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-427648, 1_000_000)].into_iter().collect(),
                    0,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                    [
                        // core tick group range: [-35, +35]
                        // skip to p1 left end
                        (-35 - 1, -427648),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                println!("result: {:?}", post_swap);
                println!("expect: {:?}", expected);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, core range to skip range, step by step + skip
            ///
            /// -2894848                   0                          2894848
            ///        -427648 (full range)              427648 (full range)
            ///           p1-------------------------------p1: 1_000_000
            /// |--------------------------|--------------------------|
            ///                            c1--******>c2 (*: skip enabled)
            fn b_to_a_core_range_to_skip_range() {
                // reach max by 35 delta tick_group_index
                let max_volatility_accumulator = 35 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_000_000,
                    curr_tick_index: 0,
                    start_tick_index: -2894848,
                    trade_amount: 1_000_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -427648,
                        liquidity_net: 1_000_000,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 427648,
                        liquidity_net: -1_000_000,
                        ..Default::default()
                    }]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result_with_max_volatility_skip(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(427648, -1_000_000)].into_iter().collect(),
                    128,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    1_000_000,
                    [
                        // core tick group range: [-35, +35]
                        // skip to p1 right end
                        (35 + 1, 427648),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence =
                    SwapTickSequence::new(swap_test_info.tick_arrays[1].borrow_mut(), None, None);
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                println!("result: {:?}", post_swap);
                println!("expect: {:?}", expected);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: 1_000_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_sqrt_price, expected.end_sqrt_price);
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }
        }

        mod ts_1_with_max_volatility_skip {
            use super::*;

            const TS: u16 = 1;
            const TICK_GROUP_SIZE: u16 = 1;

            fn adaptive_fee_info_with_max_volatility_skip(
                max_volatility_accumulator: u32,
            ) -> Option<AdaptiveFeeInfo> {
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        adaptive_fee_control_factor: 5_000,
                        reduction_factor: 500,
                        max_volatility_accumulator,
                        tick_group_size: TICK_GROUP_SIZE,
                        major_swap_threshold_ticks: TICK_GROUP_SIZE,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables::default(),
                })
            }

            #[test]
            /// a to b, from MAX_SQRT_PRICE
            ///
            /// 443432               443520               443608    443636 (full range index)
            ///                               p1---------------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<*********-----c1 (443636)
            fn a_to_b_from_max_sqrt_price() {
                // reach max by 20 delta tick_group_index
                let max_volatility_accumulator = 20 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator).unwrap();

                // set 443630 as reference tick group index
                // test will start with max volatility accumulator
                let adaptive_fee_info = Some(AdaptiveFeeInfo {
                    constants: adaptive_fee_info.constants,
                    variables: AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 0,
                        tick_group_index_reference: 443630,
                        volatility_reference: 0,
                        volatility_accumulator: adaptive_fee_info
                            .constants
                            .max_volatility_accumulator,
                        ..Default::default()
                    },
                });

                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 100_000_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: 443636,
                    start_tick_index: 443608,
                    trade_amount: 53, // in this extreme price range, every step consumes only 2u64 (1 fee + 1 input), so this input value is chosen to traverse enough range only
                    sqrt_price_limit: MIN_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: 443636,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: 443608 - 44,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result_with_max_volatility_skip(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(443636, -p1_liquidity), (443608 - 44, p1_liquidity)]
                        .into_iter()
                        .collect(),
                    443636,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    443636,
                    1_000_000,
                    [
                        // core tick group range: [443630 - 20, none]
                        // skip to p1 left end
                        (443630 - 20 - 1, 443608 - 44),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info.trade_amount,
                        traded_amount_b: expected.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: p1_liquidity.unsigned_abs(),
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }

            #[test]
            /// b to a, from MIN_SQRT_PRICE
            ///
            /// -443696     -443636  -443608              -443520
            ///             p1-----------------p1: 100
            /// |--------------------|--------------------|--------------------|
            ///   (-443636) c1----********>c2
            fn b_to_a_from_min_sqrt_price() {
                // reach max by 20 delta tick_group_index
                let max_volatility_accumulator = 20 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator).unwrap();

                // set -443630 as reference tick group index
                // test will start with max volatility accumulator
                let adaptive_fee_info = Some(AdaptiveFeeInfo {
                    constants: adaptive_fee_info.constants,
                    variables: AdaptiveFeeVariables {
                        last_reference_update_timestamp: 1_000_000,
                        last_major_swap_timestamp: 0,
                        tick_group_index_reference: -443630,
                        volatility_reference: 0,
                        volatility_accumulator: adaptive_fee_info
                            .constants
                            .max_volatility_accumulator,
                        ..Default::default()
                    },
                });

                let static_fee_rate = 1000; // 0.1%
                let protocol_fee_rate = 100; // 1%

                let p1_liquidity = 1_000_000i128;

                let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 0,
                    curr_tick_index: -443637, // shifted
                    curr_sqrt_price_override: Some(MIN_SQRT_PRICE_X64),
                    start_tick_index: -443696,
                    trade_amount: 55, // in this extreme price range, every step consumes only 2u64 (1 fee + 1 input), so this input value is chosen to traverse enough range only
                    sqrt_price_limit: MAX_SQRT_PRICE_X64,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &vec![TestTickInfo {
                        // p1
                        index: -443636,
                        liquidity_net: p1_liquidity,
                        ..Default::default()
                    }],
                    array_2_ticks: Some(&vec![TestTickInfo {
                        // p1
                        index: -443608 + 44,
                        liquidity_net: -p1_liquidity,
                        ..Default::default()
                    }]),
                    array_3_ticks: Some(&vec![]),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: static_fee_rate,
                    protocol_fee_rate,
                    ..Default::default()
                });

                let expected = get_expected_result_with_max_volatility_skip(
                    swap_test_info.a_to_b,
                    swap_test_info.whirlpool.sqrt_price,
                    swap_test_info.whirlpool.liquidity,
                    [(-443636, p1_liquidity), (-443608 + 44, -p1_liquidity)]
                        .into_iter()
                        .collect(),
                    -443636,
                    swap_test_info.trade_amount,
                    static_fee_rate,
                    protocol_fee_rate,
                    adaptive_fee_info.clone().unwrap(),
                    -443637,
                    1_000_000,
                    [
                        // core tick group range: [none, -443630 + 20]
                        // skip to p1 right end
                        (-443630 + 20 + 1, -443608 + 44),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence = SwapTickSequence::new(
                    swap_test_info.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info.tick_arrays[1].borrow_mut()),
                    Some(swap_test_info.tick_arrays[2].borrow_mut()),
                );
                let post_swap = swap_test_info.run(&mut tick_sequence, 1_000_000);

                assert_swap(
                    &post_swap,
                    &SwapTestExpectation {
                        traded_amount_a: expected.output_amount,
                        traded_amount_b: swap_test_info.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected.end_sqrt_price),
                        end_liquidity: p1_liquidity.unsigned_abs(),
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(post_swap.next_protocol_fee, expected.protocol_fee);
                check_next_adaptive_fee_variables(
                    &post_swap.next_adaptive_fee_info.unwrap().variables,
                    &expected.next_adaptive_fee_variables,
                );
            }
        }
    }

    mod consecutive_swap {
        use super::*;

        const TS: u16 = 64;
        const TICK_GROUP_SIZE: u16 = TS;

        const STATIC_FEE_RATE: u16 = 1000; // 0.1%
        const PROTOCOL_FEE_RATE: u16 = 100; // 1%

        fn adaptive_fee_info_without_max_volatility_skip() -> Option<AdaptiveFeeInfo> {
            Some(AdaptiveFeeInfo {
                constants: AdaptiveFeeConstants {
                    filter_period: 30,
                    decay_period: 600,
                    adaptive_fee_control_factor: 5_000,
                    reduction_factor: 500,
                    // block skip based on max_volatility_accumulator
                    max_volatility_accumulator: 88 * 3 * 10_000,
                    tick_group_size: TICK_GROUP_SIZE,
                    major_swap_threshold_ticks: TICK_GROUP_SIZE,
                    ..Default::default()
                },
                variables: AdaptiveFeeVariables::default(),
            })
        }

        fn adaptive_fee_info_with_max_volatility_skip(
            max_volatility_accumulator: u32,
        ) -> Option<AdaptiveFeeInfo> {
            Some(AdaptiveFeeInfo {
                constants: AdaptiveFeeConstants {
                    filter_period: 30,
                    decay_period: 600,
                    adaptive_fee_control_factor: 5_000,
                    reduction_factor: 500,
                    max_volatility_accumulator,
                    tick_group_size: TICK_GROUP_SIZE,
                    major_swap_threshold_ticks: TICK_GROUP_SIZE,
                    ..Default::default()
                },
                variables: AdaptiveFeeVariables::default(),
            })
        }

        fn tick_arrays() -> (Vec<TestTickInfo>, Vec<TestTickInfo>) {
            let tick_array_0 = vec![TestTickInfo {
                // p1
                index: 4224,
                liquidity_net: -1_500_000,
                ..Default::default()
            }];
            let tick_array_neg_5632 = vec![TestTickInfo {
                // p1
                index: -4224,
                liquidity_net: 1_500_000,
                ..Default::default()
            }];

            (tick_array_0, tick_array_neg_5632)
        }

        fn last_reference_update_timestamp(v: &AdaptiveFeeVariables) -> u64 {
            v.last_reference_update_timestamp
        }

        fn last_major_swap_timestamp(v: &AdaptiveFeeVariables) -> u64 {
            v.last_major_swap_timestamp
        }

        fn tick_group_index_reference(v: &AdaptiveFeeVariables) -> i32 {
            v.tick_group_index_reference
        }

        fn volatility_reference(v: &AdaptiveFeeVariables) -> u32 {
            v.volatility_reference
        }

        fn volatility_accumulator(v: &AdaptiveFeeVariables) -> u32 {
            v.volatility_accumulator
        }

        // another implementation of reduction
        fn reduction(volatility_accumulator: u32, reduction_factor: u16) -> u32 {
            (u64::from(volatility_accumulator) * u64::from(reduction_factor)
                / REDUCTION_FACTOR_DENOMINATOR as u64)
                .try_into()
                .unwrap()
        }

        mod no_wait {
            use super::*;

            #[test]
            /// a to b -> no wait (same timestamp) -> a to b
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                             c3<-----c2<-----c1
            fn a_to_b_and_a_to_b() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index,
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// a to b -> no wait (same timestamp) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<-----c1
            ///                                     c2-->c3
            fn a_to_b_and_b_to_a_c3_lt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: -5632,
                    trade_amount: post_swap_first.amount_b / 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    TS as i32 * (first_tick_group_index + 1), // right end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: expected_second.output_amount,
                        traded_amount_b: swap_test_info_second.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// a to b -> no wait (same timestamp) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<-----c1
            ///                                     c2----------->c3
            fn a_to_b_and_b_to_a_c3_gt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: -5632,
                    trade_amount: post_swap_first.amount_b * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    TS as i32 * (first_tick_group_index + 1), // right end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: expected_second.output_amount,
                        traded_amount_b: swap_test_info_second.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// b to a -> no wait (same timestamp) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----->c2----->c3
            fn b_to_a_and_b_to_a() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    TS as i32 * (first_tick_group_index + 1), // right end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: expected_second.output_amount,
                        traded_amount_b: swap_test_info_second.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// b to a -> no wait (same timestamp) -> a to b
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----->c2
            ///                                          c3<--c2
            fn b_to_a_and_a_to_b_c3_gt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: post_swap_first.amount_a / 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index, // left end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// b to a -> no wait (same timestamp) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----->c2
            ///                                   c3<---------c2
            fn b_to_a_and_a_to_b_c3_lt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: post_swap_first.amount_a * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index, // left end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// a to b -> no wait (same timestamp) -> a to b
            /// notes:
            /// - first swap: core range to skip range
            /// - second swap: skip range only
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                             c3<*****c2<**---c1 (*: skip enabled)
            fn a_to_b_and_a_to_b_with_max_volatility_skip() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();

                // reach max by 8 delta tick_group_index
                let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result_with_max_volatility_skip(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                    [
                        // core tick group range: [-8, +8]
                        // skip to p1 left end
                        (-8 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result_with_max_volatility_skip(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index,
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                    [
                        // core tick group range: [-8, +8]
                        // skip to p1 left end
                        (first_tick_group_index, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// b to a -> no wait (same timestamp) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----****>c2
            ///                                c3<****-------****c2
            fn b_to_a_and_a_to_b_c3_lt_c1_with_max_volatility_skip() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();

                // reach max by 8 delta tick_group_index
                let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_first = 1_000_000;

                let expected_first = get_expected_result_with_max_volatility_skip(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                    [
                        // core tick group range: [-10, +6]
                        // skip to p1 right end
                        (6 + 1, 4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: post_swap_first.amount_a * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });
                let timestamp_second = timestamp_first;

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result_with_max_volatility_skip(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index, // left end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                    [
                        // core tick group range: [-10, +6]
                        // skip to core range right end
                        (first_tick_group_index, 384 + 64),
                        // skip to p1 left end
                        (-10 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    last_reference_update_timestamp(&variables_second)
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }
        }

        mod wait_lt_filter_period {
            use super::*;

            #[test]
            /// a to b -> wait (less than filter_period) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<-----c1
            ///                                     c2----------->c3
            fn a_to_b_and_b_to_a_c3_gt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.filter_period as u64 - 1;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: -5632,
                    trade_amount: post_swap_first.amount_b * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    TS as i32 * (first_tick_group_index + 1), // right end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: expected_second.output_amount,
                        traded_amount_b: swap_test_info_second.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // references should not be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_first
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// b to a -> wait (less than filter_period) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----->c2
            ///                                   c3<---------c2
            fn b_to_a_and_a_to_b_c3_lt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.filter_period as u64 - 1;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: post_swap_first.amount_a * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index, // left end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // references should not be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_first
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }

            #[test]
            /// a to b -> wait (less than filter_period) -> a to b
            /// notes:
            /// - first swap: core range to skip range
            /// - second swap: skip range only
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                             c3<*****c2<**---c1 (*: skip enabled)
            fn a_to_b_and_a_to_b_with_max_volatility_skip() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();

                // reach max by 8 delta tick_group_index
                let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.filter_period as u64 - 1;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result_with_max_volatility_skip(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                    [
                        // core tick group range: [-8, +8]
                        // skip to p1 left end
                        (-8 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result_with_max_volatility_skip(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index,
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                    [
                        // core tick group range: [-8, +8]
                        // skip to p1 left end
                        (first_tick_group_index, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // references should not be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_first
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(
                    tick_group_index_reference(&variables_first),
                    tick_group_index_reference(&variables_second)
                );
                assert_eq!(
                    volatility_reference(&variables_first),
                    volatility_reference(&variables_second)
                );
            }
        }

        mod wait_gte_filter_period_lt_decay_period {
            use super::*;

            #[test]
            /// a to b -> wait (less than decay_period) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<-----c1
            ///                                     c2----------->c3
            fn a_to_b_and_b_to_a_c3_gt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.decay_period as u64 - 1;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: -5632,
                    trade_amount: post_swap_first.amount_b * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    TS as i32 * (first_tick_group_index + 1), // right end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: expected_second.output_amount,
                        traded_amount_b: swap_test_info_second.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let reduction_factor = adaptive_fee_info.unwrap().constants.reduction_factor;
                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // references should be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(tick_group_index_reference(&variables_first), 0);
                assert_eq!(
                    tick_group_index_reference(&variables_second),
                    first_tick_group_index
                );
                assert_eq!(volatility_reference(&variables_first), 0);
                assert_eq!(
                    volatility_reference(&variables_second),
                    reduction(volatility_accumulator(&variables_first), reduction_factor)
                );
            }

            #[test]
            /// b to a -> wait (less than decay_period) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----->c2
            ///                                   c3<---------c2
            fn b_to_a_and_a_to_b_c3_lt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.decay_period as u64 - 1;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: post_swap_first.amount_a * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index, // left end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let reduction_factor = adaptive_fee_info.unwrap().constants.reduction_factor;
                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // references should be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(tick_group_index_reference(&variables_first), -2);
                assert_eq!(
                    tick_group_index_reference(&variables_second),
                    first_tick_group_index
                );
                assert_eq!(volatility_reference(&variables_first), 0);
                assert_eq!(
                    volatility_reference(&variables_second),
                    reduction(volatility_accumulator(&variables_first), reduction_factor)
                );
            }

            #[test]
            /// a to b -> wait (less than filter_period) -> a to b
            /// notes:
            /// - first swap: core range to skip range
            /// - second swap: core range to skip range
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                             c3<**---c2<**---c1 (*: skip enabled)
            fn a_to_b_and_a_to_b_with_max_volatility_skip() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();

                // reach max by 8 delta tick_group_index
                let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.decay_period as u64 - 1;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result_with_max_volatility_skip(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                    [
                        // core tick group range: [-8, +8]
                        // skip to p1 left end
                        (-8 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result_with_max_volatility_skip(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index,
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                    [
                        // core tick group range: [first_tick_group_index - 8, first_tick_group_index + 8]
                        // skip to p1 left end
                        (first_tick_group_index - 8 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let reduction_factor = adaptive_fee_info.unwrap().constants.reduction_factor;
                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // references should be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(tick_group_index_reference(&variables_first), 0);
                assert_eq!(
                    tick_group_index_reference(&variables_second),
                    first_tick_group_index
                );
                assert_eq!(volatility_reference(&variables_first), 0);
                assert_eq!(
                    volatility_reference(&variables_second),
                    reduction(volatility_accumulator(&variables_first), reduction_factor)
                );
            }
        }

        mod wait_gte_decay_period {
            use super::*;

            #[test]
            /// a to b -> wait (greater than or equal to decay_period) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                     c2<-----c1
            ///                                     c2----------->c3
            fn a_to_b_and_b_to_a_c3_gt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.decay_period as u64;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: -5632,
                    trade_amount: post_swap_first.amount_b * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    TS as i32 * (first_tick_group_index + 1), // right end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: expected_second.output_amount,
                        traded_amount_b: swap_test_info_second.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // reference should be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(tick_group_index_reference(&variables_first), 0);
                assert_eq!(
                    tick_group_index_reference(&variables_second),
                    first_tick_group_index
                );
                assert_eq!(volatility_reference(&variables_first), 0);
                assert_eq!(volatility_reference(&variables_second), 0); // reset
            }

            #[test]
            /// b to a -> wait (greater than or equal to decay_period) -> b to a
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                                       c1----->c2
            ///                                   c3<---------c2
            fn b_to_a_and_a_to_b_c3_lt_c1() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();
                let adaptive_fee_info = adaptive_fee_info_without_max_volatility_skip();

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.decay_period as u64;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: -96,
                    start_tick_index: -5632,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: B_TO_A,
                    array_1_ticks: &tick_array_neg_5632,
                    array_2_ticks: Some(&tick_array_0),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(4224, -1_500_000)].into_iter().collect(),
                    -64,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    -2,
                    timestamp_first,
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: expected_first.output_amount,
                        traded_amount_b: swap_test_info_first.trade_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: post_swap_first.amount_a * 2,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index, // left end tick
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_second.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // reference should be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(tick_group_index_reference(&variables_first), -2);
                assert_eq!(
                    tick_group_index_reference(&variables_second),
                    first_tick_group_index
                );
                assert_eq!(volatility_reference(&variables_first), 0);
                assert_eq!(volatility_reference(&variables_second), 0); // reset
            }

            #[test]
            /// a to b -> wait (greater than or equal to decay_period) -> a to b
            /// notes:
            /// - first swap: core range to skip range
            /// - second swap: core range to skip range
            ///
            /// -11264               -5632                0                   5632
            ///                          p1------------------------------p1: 1_500_000
            /// |--------------------|--------------------|--------------------|
            ///                             c3<**---c2<**---c1 (*: skip enabled)
            fn a_to_b_and_a_to_b_with_max_volatility_skip() {
                let (tick_array_0, tick_array_neg_5632) = tick_arrays();

                // reach max by 8 delta tick_group_index
                let max_volatility_accumulator = 8 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let adaptive_fee_info =
                    adaptive_fee_info_with_max_volatility_skip(max_volatility_accumulator);

                let timestamp_delta =
                    adaptive_fee_info.clone().unwrap().constants.decay_period as u64;
                let timestamp_first = 1_000_000;
                let timestamp_second = timestamp_first + timestamp_delta;

                // first swap
                let swap_test_info_first = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: 32,
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let expected_first = get_expected_result_with_max_volatility_skip(
                    swap_test_info_first.a_to_b,
                    swap_test_info_first.whirlpool.sqrt_price,
                    swap_test_info_first.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    0,
                    swap_test_info_first.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    adaptive_fee_info.clone().unwrap(),
                    0,
                    timestamp_first,
                    [
                        // core tick group range: [-8, +8]
                        // skip to p1 left end
                        (-8 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_first = SwapTickSequence::new(
                    swap_test_info_first.tick_arrays[0].borrow_mut(),
                    Some(swap_test_info_first.tick_arrays[1].borrow_mut()),
                    None,
                );
                let post_swap_first =
                    swap_test_info_first.run(&mut tick_sequence_first, timestamp_first);

                assert_swap(
                    &post_swap_first,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_first.trade_amount,
                        traded_amount_b: expected_first.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_first.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_first.next_protocol_fee,
                    expected_first.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_first
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_first.next_adaptive_fee_variables,
                );

                // second swap

                let swap_test_info_second = SwapTestFixture::new(SwapTestFixtureInfo {
                    tick_spacing: TS,
                    liquidity: 1_500_000,
                    curr_tick_index: post_swap_first.next_tick_index,
                    curr_sqrt_price_override: Some(post_swap_first.next_sqrt_price),
                    start_tick_index: 0,
                    trade_amount: 150_000,
                    sqrt_price_limit: 0,
                    amount_specified_is_input: true,
                    a_to_b: A_TO_B,
                    array_1_ticks: &tick_array_0,
                    array_2_ticks: Some(&tick_array_neg_5632),
                    adaptive_fee_info: post_swap_first.next_adaptive_fee_info.clone(),
                    fee_rate: STATIC_FEE_RATE,
                    protocol_fee_rate: PROTOCOL_FEE_RATE,
                    ..Default::default()
                });

                let first_tick_group_index =
                    floor_division(post_swap_first.next_tick_index, TS as i32);
                let expected_second = get_expected_result_with_max_volatility_skip(
                    swap_test_info_second.a_to_b,
                    swap_test_info_second.whirlpool.sqrt_price,
                    swap_test_info_second.whirlpool.liquidity,
                    [(-4224, 1_500_000)].into_iter().collect(),
                    TS as i32 * first_tick_group_index,
                    swap_test_info_second.trade_amount,
                    STATIC_FEE_RATE,
                    PROTOCOL_FEE_RATE,
                    post_swap_first.next_adaptive_fee_info.clone().unwrap(),
                    first_tick_group_index,
                    timestamp_second,
                    [
                        // core tick group range: [first_tick_group_index - 8, first_tick_group_index + 8]
                        // skip to p1 left end
                        (first_tick_group_index - 8 - 1, -4224),
                    ]
                    .into_iter()
                    .collect(),
                );

                let mut tick_sequence_second = SwapTickSequence::new(
                    swap_test_info_second.tick_arrays[1].borrow_mut(),
                    None,
                    None,
                );
                let post_swap_second =
                    swap_test_info_second.run(&mut tick_sequence_second, timestamp_second);

                assert_swap(
                    &post_swap_second,
                    &SwapTestExpectation {
                        traded_amount_a: swap_test_info_second.trade_amount,
                        traded_amount_b: expected_second.output_amount,
                        end_tick_index: tick_index_from_sqrt_price(&expected_second.end_sqrt_price),
                        end_liquidity: 1_500_000,
                        end_reward_growths: [0, 0, 0],
                    },
                );
                assert_eq!(
                    post_swap_second.next_protocol_fee,
                    expected_second.protocol_fee
                );
                check_next_adaptive_fee_variables(
                    &post_swap_second
                        .next_adaptive_fee_info
                        .clone()
                        .unwrap()
                        .variables,
                    &expected_second.next_adaptive_fee_variables,
                );

                let variables_first = post_swap_first.next_adaptive_fee_info.unwrap().variables;
                let variables_second = post_swap_second.next_adaptive_fee_info.unwrap().variables;
                // reference should be updated at the second swap
                assert_eq!(
                    last_reference_update_timestamp(&variables_first),
                    timestamp_first
                );
                assert_eq!(
                    last_reference_update_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(last_major_swap_timestamp(&variables_first), timestamp_first);
                assert_eq!(
                    last_major_swap_timestamp(&variables_second),
                    timestamp_second
                );
                assert_eq!(tick_group_index_reference(&variables_first), 0);
                assert_eq!(
                    tick_group_index_reference(&variables_second),
                    first_tick_group_index
                );
                assert_eq!(volatility_reference(&variables_first), 0);
                assert_eq!(volatility_reference(&variables_second), 0); // reset
            }
        }
    }

    mod max_reference_age_reset {
        use super::*;
        use crate::manager::fee_rate_manager::MAX_REFERENCE_AGE;

        // Even if major swaps are continuous for a long time, references are reset when their age exceed MAX_REFERENCE_AGE
        // This is an autonomous means of recovering from DoS that keeps the fee rate high and makes the pool unusable
        #[test]
        fn test_max_reference_age_reset() {
            let max_volatility_accumulator = 350_000;
            let high_volatility = max_volatility_accumulator - 20000;

            let constants = AdaptiveFeeConstants {
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 3000,
                adaptive_fee_control_factor: 4_000,
                max_volatility_accumulator,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                ..Default::default()
            };
            let initial_variables = AdaptiveFeeVariables {
                last_reference_update_timestamp: 0,
                last_major_swap_timestamp: 0,
                tick_group_index_reference: 1,
                volatility_accumulator: high_volatility,
                volatility_reference: high_volatility,
                ..Default::default()
            };

            let timestamp_delta = constants.filter_period as u64 - 1;
            let max_timestamp = MAX_REFERENCE_AGE + 5 * timestamp_delta;

            let mut timestamp = 0;
            let mut variables = initial_variables;
            let mut a_to_b = true;
            while timestamp <= max_timestamp {
                // 0                    64                  128
                // |--------------------|--------------------|
                //      16 <--------------------------- 112 : a to b
                //      16 ---------------------------> 112 : b to a
                let (start_tick, end_tick) = if a_to_b { (112, 16) } else { (16, 112) };

                // swap simulation
                let next_variables = {
                    let mut fee_rate_manager = FeeRateManager::new(
                        a_to_b,
                        start_tick,
                        timestamp,
                        3000,
                        &Some(AdaptiveFeeInfo {
                            constants,
                            variables,
                        }),
                    )
                    .unwrap();

                    // 1st iteration
                    // 112 -> 64 (a to b)
                    // 16 -> 64 (b to a)
                    fee_rate_manager.update_volatility_accumulator().unwrap();
                    fee_rate_manager.advance_tick_group();
                    // 2nd iteration
                    // 64 -> 16 (a to b)
                    // 64 -> 112 (b to a)
                    fee_rate_manager.update_volatility_accumulator().unwrap();
                    fee_rate_manager.advance_tick_group();

                    // update major swap timestamp
                    fee_rate_manager
                        .update_major_swap_timestamp(
                            timestamp,
                            sqrt_price_from_tick_index(start_tick),
                            sqrt_price_from_tick_index(end_tick),
                        )
                        .unwrap();

                    fee_rate_manager
                        .get_next_adaptive_fee_info()
                        .unwrap()
                        .variables
                };

                println!("timestamp: {}, variables: {:?}", timestamp, next_variables);

                if timestamp <= MAX_REFERENCE_AGE {
                    // no change because major swaps happened
                    assert!(next_variables.volatility_reference == high_volatility);
                    assert!(next_variables.last_reference_update_timestamp == 0);
                    assert!(next_variables.last_major_swap_timestamp == timestamp);
                } else {
                    // should be reset
                    assert!(next_variables.volatility_reference == 0);
                    assert!(next_variables.last_reference_update_timestamp > 0);
                    assert!(next_variables.last_major_swap_timestamp == timestamp);
                }

                variables = next_variables;
                timestamp += timestamp_delta;
                a_to_b = !a_to_b;
            }

            assert!(variables.volatility_reference == 0);
        }
    }

    mod sqrt_price_limit_edge_case {
        use super::*;

        #[test]
        fn test_sqrt_price_limit_ne_whirlpool_sqrt_price() {
            let max_volatility_accumulator = 350_000;
            let high_volatility = max_volatility_accumulator - 20000;

            let constants = AdaptiveFeeConstants {
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000, // 50%
                adaptive_fee_control_factor: 4_000,
                max_volatility_accumulator,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                ..Default::default()
            };
            let initial_variables = AdaptiveFeeVariables {
                last_reference_update_timestamp: 0,
                last_major_swap_timestamp: 0,
                tick_group_index_reference: 1,
                volatility_accumulator: high_volatility,
                volatility_reference: high_volatility,
                ..Default::default()
            };

            let timestamp_delta = constants.filter_period as u64 + 1;

            let mut timestamp = 0;
            let mut variables = initial_variables;
            let mut a_to_b = true;
            // loop 33 times (u32::MAX >> 32 should be 0)
            for _ in 0..=32 {
                // 0                    64                  128
                // |--------------------|--------------------|
                //                               111 <- 112 : a to b
                //                               111 -> 112 : b to a
                let (start_tick, end_tick) = if a_to_b { (112, 111) } else { (111, 112) };

                // swap simulation
                let next_variables = {
                    let mut fee_rate_manager = FeeRateManager::new(
                        a_to_b,
                        start_tick,
                        timestamp,
                        3000,
                        &Some(AdaptiveFeeInfo {
                            constants,
                            variables,
                        }),
                    )
                    .unwrap();

                    // 1st iteration
                    fee_rate_manager.update_volatility_accumulator().unwrap();
                    fee_rate_manager.advance_tick_group();

                    // update major swap timestamp
                    fee_rate_manager
                        .update_major_swap_timestamp(
                            timestamp,
                            sqrt_price_from_tick_index(start_tick),
                            sqrt_price_from_tick_index(end_tick),
                        )
                        .unwrap();

                    fee_rate_manager
                        .get_next_adaptive_fee_info()
                        .unwrap()
                        .variables
                };

                println!("timestamp: {}, variables: {:?}", timestamp, next_variables);

                let num_reduction = timestamp / timestamp_delta;
                if num_reduction > 0 {
                    // reduction: 50%
                    let expected_volatility_reference =
                        (initial_variables.volatility_accumulator as u64 >> num_reduction) as u32;
                    assert!(next_variables.volatility_reference == expected_volatility_reference);
                }

                variables = next_variables;
                timestamp += timestamp_delta;
                a_to_b = !a_to_b;
            }

            assert!(variables.volatility_reference == 0);
        }

        // sqrt_price_limit that matches the pool's sqrt_price does not error
        // reduction should work even if the swap loop does not run at all
        #[test]
        fn test_sqrt_price_limit_eq_whirlpool_sqrt_price() {
            let max_volatility_accumulator = 350_000;
            let high_volatility = max_volatility_accumulator - 20000;

            let constants = AdaptiveFeeConstants {
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000, // 50%
                adaptive_fee_control_factor: 4_000,
                max_volatility_accumulator,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                ..Default::default()
            };
            let initial_variables = AdaptiveFeeVariables {
                last_reference_update_timestamp: 0,
                last_major_swap_timestamp: 0,
                tick_group_index_reference: 1,
                volatility_accumulator: high_volatility,
                volatility_reference: high_volatility,
                ..Default::default()
            };

            let timestamp_delta = constants.filter_period as u64 + 1;

            let mut timestamp = 0;
            let mut variables = initial_variables;
            let mut a_to_b = true;
            // loop 33 times (u32::MAX >> 32 should be 0)
            for _ in 0..=32 {
                // 0                    64                  128
                // |--------------------|--------------------|
                //                                     112 (no move) : a to b
                //                                     112 (no move) : b to a
                let (start_tick, end_tick) = (112, 112);

                // swap simulation
                let next_variables = {
                    let mut fee_rate_manager = FeeRateManager::new(
                        a_to_b,
                        start_tick,
                        timestamp,
                        3000,
                        &Some(AdaptiveFeeInfo {
                            constants,
                            variables,
                        }),
                    )
                    .unwrap();

                    // NO iteration

                    // update major swap timestamp
                    fee_rate_manager
                        .update_major_swap_timestamp(
                            timestamp,
                            sqrt_price_from_tick_index(start_tick),
                            sqrt_price_from_tick_index(end_tick),
                        )
                        .unwrap();

                    fee_rate_manager
                        .get_next_adaptive_fee_info()
                        .unwrap()
                        .variables
                };

                println!("timestamp: {}, variables: {:?}", timestamp, next_variables);

                let num_reduction = timestamp / timestamp_delta;
                if num_reduction > 0 {
                    // reduction: 50%
                    let expected_volatility_reference =
                        (initial_variables.volatility_accumulator as u64 >> num_reduction) as u32;
                    assert!(next_variables.volatility_reference == expected_volatility_reference);
                }

                variables = next_variables;
                timestamp += timestamp_delta;
                a_to_b = !a_to_b;
            }

            assert!(variables.volatility_reference == 0);
        }
    }
}
