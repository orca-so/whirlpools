use crate::{
    errors::ErrorCode,
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
}

pub fn swap(
    whirlpool: &Whirlpool,
    swap_tick_sequence: &mut SwapTickSequence,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    timestamp: u64,
) -> Result<PostSwapUpdate> {
    if sqrt_price_limit < MIN_SQRT_PRICE_X64 || sqrt_price_limit > MAX_SQRT_PRICE_X64 {
        return Err(ErrorCode::SqrtPriceOutOfBounds.into());
    }

    if a_to_b && sqrt_price_limit > whirlpool.sqrt_price
        || !a_to_b && sqrt_price_limit < whirlpool.sqrt_price
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

    while amount_remaining > 0 && sqrt_price_limit != curr_sqrt_price {
        let (next_array_index, next_tick_index) = swap_tick_sequence
            .get_next_initialized_tick_index(
                curr_tick_index,
                tick_spacing,
                a_to_b,
                curr_array_index,
            )?;

        let (next_tick_sqrt_price, sqrt_price_target) =
            get_next_sqrt_prices(next_tick_index, sqrt_price_limit, a_to_b);

        let swap_computation = compute_swap(
            amount_remaining,
            fee_rate,
            curr_liquidity,
            curr_sqrt_price,
            sqrt_price_target,
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
                    &next_tick.unwrap(),
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
    }

    let (amount_a, amount_b) = if a_to_b == amount_specified_is_input {
        (amount - amount_remaining, amount_calculated)
    } else {
        (amount_calculated, amount - amount_remaining)
    };

    Ok(PostSwapUpdate {
        amount_a,
        amount_b,
        next_liquidity: curr_liquidity,
        next_tick_index: curr_tick_index,
        next_sqrt_price: curr_sqrt_price,
        next_fee_growth_global: curr_fee_growth_global_input,
        next_reward_infos,
        next_protocol_fee: curr_protocol_fee,
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
            &tick_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let tick_upper = tick_sequence.get_tick(1, 720, TS_8).unwrap();
        assert_swap_tick_state(
            &tick_upper,
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
            &lower_tick,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let lower_tick = tick_sequence.get_tick(2, 448, TS_8).unwrap();
        assert_swap_tick_state(
            &lower_tick,
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
            &tick,
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
            &tick,
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
        assert_swap_tick_state(&p1_lower, &TickExpectation::default());
        assert_swap_tick_state(
            &p1_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let p2_lower = tick_sequence.get_tick(1, 1120, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(2, 1536, TS_8).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(&p2_upper, &TickExpectation::default());
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
        assert_swap_tick_state(&p1_lower, &TickExpectation::default());
        assert_swap_tick_state(
            &p1_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let p2_lower = tick_sequence.get_tick(1, 1120, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 1448, TS_8).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(&p2_upper, &TickExpectation::default());
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
            &p1_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(&p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(0, 128, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 320, TS_8).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p2_upper,
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
            &p1_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p1_upper,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        let p2_lower = tick_sequence.get_tick(0, 128, TS_8).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 320, TS_8).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p2_upper,
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
        assert_swap_tick_state(&p1_lower, &TickExpectation::default());
        assert_swap_tick_state(&p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(0, 28416, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(1, 33920, TS_128).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p2_upper,
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
        assert_swap_tick_state(&p1_lower, &TickExpectation::default());
        assert_swap_tick_state(&p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(1, 28416, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 30720, TS_128).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p2_upper,
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
        assert_swap_tick_state(&p1_lower, &TickExpectation::default());
        assert_swap_tick_state(&p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(0, 30336, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(2, 56192, TS_128).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p2_upper,
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
        assert_swap_tick_state(&p1_lower, &TickExpectation::default());
        assert_swap_tick_state(&p1_upper, &TickExpectation::default());
        let p2_lower = tick_sequence.get_tick(2, 30336, TS_128).unwrap();
        let p2_upper = tick_sequence.get_tick(0, 48512, TS_128).unwrap();
        assert_swap_tick_state(
            &p2_lower,
            &TickExpectation {
                fee_growth_outside_a: 100,
                fee_growth_outside_b: 100,
                reward_growths_outside: [10, 10, 10],
            },
        );
        assert_swap_tick_state(
            &p2_upper,
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
        // Use filled arrays to minimize the the overflow from calculations, rather than accumulation
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
