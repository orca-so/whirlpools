use super::{
    position_manager::next_position_modify_liquidity_update,
    tick_array_manager::{calculate_modify_tick_array, TickArrayUpdate},
    tick_manager::{
        next_fee_growths_inside, next_reward_growths_inside, next_tick_modify_liquidity_update,
    },
    whirlpool_manager::{next_whirlpool_liquidity, next_whirlpool_reward_infos},
};
use crate::{
    errors::ErrorCode,
    math::{get_amount_delta_a, get_amount_delta_b, sqrt_price_from_tick_index},
    state::*,
};
use anchor_lang::prelude::*;

#[derive(Debug)]
pub struct ModifyLiquidityUpdate {
    pub whirlpool_liquidity: u128,
    pub tick_lower_update: TickUpdate,
    pub tick_upper_update: TickUpdate,
    pub reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
    pub position_update: PositionUpdate,
    pub tick_array_lower_update: TickArrayUpdate,
    pub tick_array_upper_update: TickArrayUpdate,
}

// Calculates state after modifying liquidity by the liquidity_delta for the given positon.
// Fee and reward growths will also be calculated by this function.
// To trigger only calculation of fee and reward growths, use calculate_fee_and_reward_growths.
pub fn calculate_modify_liquidity<'info>(
    whirlpool: &Whirlpool,
    position: &Position,
    tick_array_lower: &dyn TickArrayType,
    tick_array_upper: &dyn TickArrayType,
    liquidity_delta: i128,
    timestamp: u64,
) -> Result<ModifyLiquidityUpdate> {
    let tick_lower =
        tick_array_lower.get_tick(position.tick_lower_index, whirlpool.tick_spacing)?;

    let tick_upper =
        tick_array_upper.get_tick(position.tick_upper_index, whirlpool.tick_spacing)?;

    _calculate_modify_liquidity(
        whirlpool,
        position,
        &tick_lower,
        &tick_upper,
        position.tick_lower_index,
        position.tick_upper_index,
        tick_array_lower.is_variable_size(),
        tick_array_upper.is_variable_size(),
        liquidity_delta,
        timestamp,
    )
}

pub fn calculate_fee_and_reward_growths<'info>(
    whirlpool: &Whirlpool,
    position: &Position,
    tick_array_lower: &dyn TickArrayType,
    tick_array_upper: &dyn TickArrayType,
    timestamp: u64,
) -> Result<(PositionUpdate, [WhirlpoolRewardInfo; NUM_REWARDS])> {
    let tick_lower =
        tick_array_lower.get_tick(position.tick_lower_index, whirlpool.tick_spacing)?;

    let tick_upper =
        tick_array_upper.get_tick(position.tick_upper_index, whirlpool.tick_spacing)?;

    // Pass in a liquidity_delta value of 0 to trigger only calculations for fee and reward growths.
    // Calculating fees and rewards for positions with zero liquidity will result in an error.
    let update = _calculate_modify_liquidity(
        whirlpool,
        position,
        &tick_lower,
        &tick_upper,
        position.tick_lower_index,
        position.tick_upper_index,
        tick_array_lower.is_variable_size(),
        tick_array_upper.is_variable_size(),
        0,
        timestamp,
    )?;
    Ok((update.position_update, update.reward_infos))
}

// Calculates the state changes after modifying liquidity of a whirlpool position.
#[allow(clippy::too_many_arguments)]
fn _calculate_modify_liquidity(
    whirlpool: &Whirlpool,
    position: &Position,
    tick_lower: &Tick,
    tick_upper: &Tick,
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_array_lower_variable_size: bool,
    tick_array_upper_variable_size: bool,
    liquidity_delta: i128,
    timestamp: u64,
) -> Result<ModifyLiquidityUpdate> {
    // Disallow only updating position fee and reward growth when position has zero liquidity
    if liquidity_delta == 0 && position.liquidity == 0 {
        return Err(ErrorCode::LiquidityZero.into());
    }

    let next_reward_infos = next_whirlpool_reward_infos(whirlpool, timestamp)?;

    let next_global_liquidity = next_whirlpool_liquidity(
        whirlpool,
        position.tick_upper_index,
        position.tick_lower_index,
        liquidity_delta,
    )?;

    let tick_lower_update = next_tick_modify_liquidity_update(
        tick_lower,
        tick_lower_index,
        whirlpool.tick_current_index,
        whirlpool.fee_growth_global_a,
        whirlpool.fee_growth_global_b,
        &next_reward_infos,
        liquidity_delta,
        false,
    )?;

    let tick_upper_update = next_tick_modify_liquidity_update(
        tick_upper,
        tick_upper_index,
        whirlpool.tick_current_index,
        whirlpool.fee_growth_global_a,
        whirlpool.fee_growth_global_b,
        &next_reward_infos,
        liquidity_delta,
        true,
    )?;

    let (fee_growth_inside_a, fee_growth_inside_b) = next_fee_growths_inside(
        whirlpool.tick_current_index,
        tick_lower,
        tick_lower_index,
        tick_upper,
        tick_upper_index,
        whirlpool.fee_growth_global_a,
        whirlpool.fee_growth_global_b,
    );

    let reward_growths_inside = next_reward_growths_inside(
        whirlpool.tick_current_index,
        tick_lower,
        tick_lower_index,
        tick_upper,
        tick_upper_index,
        &next_reward_infos,
    );

    let position_update = next_position_modify_liquidity_update(
        position,
        liquidity_delta,
        fee_growth_inside_a,
        fee_growth_inside_b,
        &reward_growths_inside,
    )?;

    let tick_array_lower_update = calculate_modify_tick_array(
        position,
        &position_update,
        tick_array_lower_variable_size,
        tick_lower,
        &tick_lower_update,
    )?;

    let tick_array_upper_update = calculate_modify_tick_array(
        position,
        &position_update,
        tick_array_upper_variable_size,
        tick_upper,
        &tick_upper_update,
    )?;

    Ok(ModifyLiquidityUpdate {
        whirlpool_liquidity: next_global_liquidity,
        reward_infos: next_reward_infos,
        position_update,
        tick_lower_update,
        tick_upper_update,
        tick_array_lower_update,
        tick_array_upper_update,
    })
}

pub fn calculate_liquidity_token_deltas(
    current_tick_index: i32,
    sqrt_price: u128,
    position: &Position,
    liquidity_delta: i128,
) -> Result<(u64, u64)> {
    if liquidity_delta == 0 {
        return Err(ErrorCode::LiquidityZero.into());
    }

    let mut delta_a: u64 = 0;
    let mut delta_b: u64 = 0;

    let liquidity: u128 = liquidity_delta.unsigned_abs();
    let round_up = liquidity_delta > 0;

    let lower_price = sqrt_price_from_tick_index(position.tick_lower_index);
    let upper_price = sqrt_price_from_tick_index(position.tick_upper_index);

    if current_tick_index < position.tick_lower_index {
        // current tick below position
        delta_a = get_amount_delta_a(lower_price, upper_price, liquidity, round_up)?;
    } else if current_tick_index < position.tick_upper_index {
        // current tick inside position
        delta_a = get_amount_delta_a(sqrt_price, upper_price, liquidity, round_up)?;
        delta_b = get_amount_delta_b(lower_price, sqrt_price, liquidity, round_up)?;
    } else {
        // current tick above position
        delta_b = get_amount_delta_b(lower_price, upper_price, liquidity, round_up)?;
    }

    Ok((delta_a, delta_b))
}

pub fn sync_modify_liquidity_values<'info>(
    whirlpool: &mut Whirlpool,
    position: &mut Position,
    tick_array_lower: &mut dyn TickArrayType,
    tick_array_upper: Option<&mut dyn TickArrayType>,
    modify_liquidity_update: &ModifyLiquidityUpdate,
    reward_last_updated_timestamp: u64,
) -> Result<()> {
    position.update(&modify_liquidity_update.position_update);

    tick_array_lower.update_tick(
        position.tick_lower_index,
        whirlpool.tick_spacing,
        &modify_liquidity_update.tick_lower_update,
    )?;

    if let Some(tick_array_upper) = tick_array_upper {
        tick_array_upper.update_tick(
            position.tick_upper_index,
            whirlpool.tick_spacing,
            &modify_liquidity_update.tick_upper_update,
        )?;
    } else {
        // Upper and lower tick arrays are the same so we only have one ref
        tick_array_lower.update_tick(
            position.tick_upper_index,
            whirlpool.tick_spacing,
            &modify_liquidity_update.tick_upper_update,
        )?;
    }

    whirlpool.update_rewards_and_liquidity(
        modify_liquidity_update.reward_infos,
        modify_liquidity_update.whirlpool_liquidity,
        reward_last_updated_timestamp,
    );

    Ok(())
}

#[cfg(test)]
mod calculate_modify_liquidity_unit_tests {
    // Test position start => end state transitions after applying possible liquidity_delta values.
    // x => position has no liquidity
    // o => position has non-zero liquidity
    // x => tick is not initialized
    // o => tick is initialized
    // ox_position indicates position with liquidity has zero liquidity after modifying liquidity
    // xo_lower indicates lower tick was initialized after modifying liquidity

    // Position with zero liquidity remains in zero liquidity state
    // Only possible with negative and zero liquidity delta values which all result in errors
    // Current tick index location relative to position does not matter
    mod xx_position {
        use crate::{manager::liquidity_manager::_calculate_modify_liquidity, util::*};

        // Zero liquidity delta on position with zero liquidity is not allowed
        #[test]
        #[should_panic(expected = "LiquidityZero")]
        fn zero_delta_on_empty_position_not_allowed() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 0,
                tick_lower_liquidity_gross: 0,
                tick_upper_liquidity_gross: 0,
                fee_growth_global_a: 0,
                fee_growth_global_b: 0,
                reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
            });
            _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                0,
                100,
            )
            .unwrap();
        }

        // Removing liquidity from position with zero liquidity results in error
        // LiquidityUnderflow from lower tick (xx_oo)
        #[test]
        #[should_panic(expected = "LiquidityUnderflow")]
        fn neg_delta_lower_tick_liquidity_underflow() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 0,
                tick_lower_liquidity_gross: 0,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: 0,
                fee_growth_global_b: 0,
                reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
            });
            _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -10,
                100,
            )
            .unwrap();
        }

        // Removing liquidity from position with zero liquidity results in error
        // LiquidityUnderflow from upper tick (oo_xx)
        #[test]
        #[should_panic(expected = "LiquidityUnderflow")]
        fn neg_delta_upper_tick_liquidity_underflow() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 0,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 0,
                fee_growth_global_a: 0,
                fee_growth_global_b: 0,
                reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
            });
            _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -10,
                100,
            )
            .unwrap();
        }

        // Removing liquidity from position with zero liquidity results in error
        // LiquidityUnderflow from updating position (oo_oo - not ticks)
        #[test]
        #[should_panic(expected = "LiquidityUnderflow")]
        fn neg_delta_position_liquidity_underflow() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 0,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: 0,
                fee_growth_global_b: 0,
                reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
            });
            _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -10,
                100,
            )
            .unwrap();
        }
    }

    // Position with zero liquidity transitions to positive liquidity
    // Only possible with positive liquidity delta values
    mod xo_position {

        // Current tick below position
        // Whirlpool virtual liquidity does not change
        mod current_tick_below {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            // Position liquidity increase, checkpoint zero values
            // Lower tick initialized, liquidity increase, checkpoint zero values
            // Upper tick initialized, liquidity increase, checkpoint zero values
            #[test]
            fn pos_delta_current_tick_below_xo_lower_xo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: -10,
                            ..Default::default()
                        },
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint zero values
            // Lower tick initialized, liquidity increase, checkpoint zero values
            // Upper tick already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_below_xo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint underflowed values
            // Lower tick initialized, liquidity increase, checkpoint zero values
            // Upper tick already initialized, has non-zero checkpoint values
            // Simulates two left tick crossings in order to reach underflow edge case
            #[test]
            fn pos_delta_current_tick_below_xo_lower_oo_upper_underflow() {
                // Underflow occurs when the lower tick is newly initialized and the upper tick
                // is already initialized with non-zero growth checkpoints.

                // The upper tick only has non-zero checkpoints when it was either 1) initialized
                // when current tick is above or 2) when it was crossed after some global fee growth
                // occurred.

                // This test simulates two tick crossings from right to left before adding liquidity
                // to the position.
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(10),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });
                test.increment_whirlpool_reward_growths_by_time(100);
                test.cross_tick(TickLabel::Upper, Direction::Left);
                // Check crossing an upper tick with liquidity added new whirlpool liquidity
                assert_eq!(test.whirlpool.liquidity, 110);
                // 1 = 0 + (100/100)
                assert_whirlpool_reward_growths(&test.whirlpool.reward_infos, to_x64(1));
                test.increment_whirlpool_fee_growths(to_x64(10), to_x64(10));
                test.increment_whirlpool_reward_growths_by_time(100);
                test.cross_tick(TickLabel::Lower, Direction::Left);
                // Lower tick has 0 net liquidity, so crossing does not affect whirlpool liquidity
                assert_eq!(test.whirlpool.liquidity, 110);
                // 1.909 = 1 + (100/110)
                assert_whirlpool_reward_growths(&test.whirlpool.reward_infos, 35216511413445507630);

                // Create position which initializes the lower tick
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    300,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        // Current tick below position, so does not add to whirlpool liquidity
                        whirlpool_liquidity: 110,
                        // 2.8181 = 1.909 + 0.909
                        whirlpool_reward_growths: create_reward_growths(51986278753181463644),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            // Wrapped underflow -10 = 20 - (20 - 0) - (10)
                            fee_growth_checkpoint_a: 340282366920938463278907166694672695296,
                            // Wrapped underflow -10
                            fee_growth_checkpoint_b: 340282366920938463278907166694672695296,
                            reward_infos: create_position_reward_infos(
                                340282366920938463444927863358058659840,
                                0,
                            ),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(10),
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint zero values
            // Lower tick already initialized, liquidity increase
            // Upper tick already initialized, liquidity increase, checkpoint zero values
            #[test]
            fn pos_delta_current_tick_below_oo_lower_xo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: -10,
                            ..Default::default()
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint zero values
            // Lower tick already initialized, liquidity increase
            // Upper tick already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_below_oo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
            }
        }

        // Current tick inside position
        // Whirlpool virtual liquidity increases
        mod current_tick_inside {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            // Position liquidity increase, checkpoint zero values
            // Lower tick initialized, liquidity increase, checkpoint current values
            // Upper tick initialized, liquidity increase, checkpoint zero values
            #[test]
            fn pos_delta_current_tick_inside_xo_lower_xo_upper() {
                // Both ticks are uninitialized. This is the first position to use this tick range
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: 0,
                    fee_growth_global_b: 0,
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 110,
                        whirlpool_reward_growths: create_reward_growths(to_x64(1)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: -10,
                            ..Default::default()
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint zero values
            // Lower tick initialized, liquidity increase, checkpoint current values
            // Upper already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_inside_xo_lower_oo_upper() {
                // This is the first position to use this tick range
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 110,
                        whirlpool_reward_growths: create_reward_growths(to_x64(1)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint underflowed values
            // Lower tick initialized, liquidity increase, checkpoint current values
            // Upper already initialized, liquidity increase
            // Simulates one left tick crossings in order to reach underflow edge case
            #[test]
            fn pos_delta_current_tick_inside_xo_lower_oo_upper_underflow() {
                // Underflow occurs when the lower tick is newly initialized and the upper tick
                // is already initialized with non-zero growth checkpoints.

                // The upper tick only has non-zero checkpoints when it was either 1) initialized
                // when current tick is above or 2) when it was crossed after some global fee growth
                // occurred.

                // This test simulates one tick crossing from left to right before adding liquidity
                // to the position.
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(10),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });
                test.increment_whirlpool_reward_growths_by_time(100);
                test.cross_tick(TickLabel::Upper, Direction::Left);
                // Check crossing an upper tick with liquidity added new whirlpool liquidity
                assert_eq!(test.whirlpool.liquidity, 110);
                // 1 = 0 + (100/100)
                assert_whirlpool_reward_growths(&test.whirlpool.reward_infos, to_x64(1));

                // Create position which initializes the lower tick
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    200,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        // Current tick inside position, so whirlpool liquidity increases
                        whirlpool_liquidity: 120,
                        // 1.909 = 1 + 0.909
                        whirlpool_reward_growths: create_reward_growths(35216511413445507630),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            // Wrapped underflow -10
                            fee_growth_checkpoint_a: 340282366920938463278907166694672695296,
                            // Wrapped underflow -10
                            fee_growth_checkpoint_b: 340282366920938463278907166694672695296,
                            reward_infos: create_position_reward_infos(
                                340282366920938463444927863358058659840,
                                0,
                            ),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(10),
                            // 1.909
                            reward_growths_outside: create_reward_growths(35216511413445507630),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(10),
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint current inside growth values
            // Lower tick already initialized, liquidity increase
            // Upper tick initialized, liquidity increase, checkpoint zero values
            #[test]
            fn pos_delta_current_tick_inside_oo_lower_xo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 110,
                        whirlpool_reward_growths: create_reward_growths(to_x64(1)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            fee_growth_checkpoint_a: to_x64(10),
                            fee_growth_checkpoint_b: to_x64(20),
                            reward_infos: create_position_reward_infos(to_x64(1), 0),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: -10,
                            ..Default::default()
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint current inside growth values
            // Lower tick already initialized, liquidity increase
            // Upper tick already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_inside_oo_lower_oo_upper() {
                // Ticks already initialized with liquidity from other position
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 110,
                        whirlpool_reward_growths: create_reward_growths(to_x64(1)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            fee_growth_checkpoint_a: to_x64(10),
                            fee_growth_checkpoint_b: to_x64(20),
                            reward_infos: create_position_reward_infos(to_x64(1), 0),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
            }
        }

        // Current tick above position
        // Whirlpool virtual liquidity does not change
        mod current_tick_above {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            // Position liquidity increase, checkpoint zero values
            // Lower tick initialized, liquidity increase, checkpoint current values
            // Upper tick initialized, liquidity increase, checkpoint current values
            #[test]
            fn pos_delta_current_tick_above_xo_lower_xo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(3)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: -10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(3)),
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint underflowed values
            // Lower tick initialized, liquidity increase, checkpoint current values
            // Upper tick already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_above_xo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            // Wrapped underflow -10
                            fee_growth_checkpoint_a: 340282366920938463278907166694672695296,
                            // Wrapped underflow -20
                            fee_growth_checkpoint_b: 340282366920938463094439725957577179136,
                            reward_infos: create_position_reward_infos(
                                340282366920938463408034375210639556608,
                                0,
                            ),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(3)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
            }

            // Adds liquidity to a new position where the checkpoints underflow.
            // Simulates the whirlpool current tick moving below the upper tick, accruing fees
            // and rewards, and then moving back above the tick. The calculated owed token amounts
            // are verified to be correct with underflowed checkpoints.
            #[test]
            fn pos_delta_current_tick_above_xo_lower_oo_upper_underflow_owed_amounts_ok() {
                // l < u < c, t = 0 to 100
                // global fee growth a: 10, fee growth b: 10, rewards: 1
                // create new position with 10 liquidity
                // lower tick initialized now - checkpoint current growths
                // upper tick already initialized with zero value checkpoints
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(10),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), 0),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(1)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            // Wrapped underflow -10
                            fee_growth_checkpoint_a: 340282366920938463278907166694672695296,
                            // Wrapped underflow -10
                            fee_growth_checkpoint_b: 340282366920938463278907166694672695296,
                            reward_infos: create_position_reward_infos(
                                340282366920938463444927863358058659840,
                                0,
                            ),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(10),
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
                test.apply_update(&update, 100);

                // l < c < u, t = 100 to 200
                // simulate crossing upper tick from right to left (price decrease)
                // global fee growth a: 20, fee growth b: 20
                // upper tick checkpoints are inverted
                // -120, 0, 120
                test.increment_whirlpool_fee_growths(to_x64(10), to_x64(10));
                test.increment_whirlpool_reward_growths_by_time(100);
                test.cross_tick(TickLabel::Upper, Direction::Left);

                assert_whirlpool_reward_growths(&test.whirlpool.reward_infos, to_x64(2));
                assert_eq!(
                    test.tick_upper,
                    Tick {
                        initialized: true,
                        liquidity_net: -20,
                        liquidity_gross: 20,
                        // 20 = 20 - 0
                        fee_growth_outside_a: to_x64(20),
                        // 20 = 20 - 0
                        fee_growth_outside_b: to_x64(20),
                        // 2 = (1 + (100/100)) - 0
                        reward_growths_outside: create_reward_growths(to_x64(2)),
                    }
                );

                // l < u < c, t = 200 to 300
                // simulate crossing upper tick from left to right (price increase)
                // global fee growth a: 35, fee growth b: 35
                // upper tick checkpoints are inverted
                test.increment_whirlpool_fee_growths(to_x64(15), to_x64(15));
                test.increment_whirlpool_reward_growths_by_time(100);
                // 2.83 = 2 + 100/120
                assert_whirlpool_reward_growths(&test.whirlpool.reward_infos, 52265774875510396245);

                test.cross_tick(TickLabel::Upper, Direction::Right);
                assert_eq!(
                    test.tick_upper,
                    Tick {
                        initialized: true,
                        liquidity_net: -20,
                        liquidity_gross: 20,
                        // 15 = 35 - 20
                        fee_growth_outside_a: to_x64(15),
                        // 15 = 35 - 20
                        fee_growth_outside_b: to_x64(15),
                        // 0.83 = 2.83 - 2
                        reward_growths_outside: create_reward_growths(15372286728091293013),
                    }
                );

                // t = 300 to 400, recalculate position fees/rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    400,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        // 3.83 = 2.83 + 100/100
                        whirlpool_reward_growths: create_reward_growths(70712518949219947861),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            fee_growth_checkpoint_a: to_x64(5),
                            fee_owed_a: 150,
                            fee_growth_checkpoint_b: to_x64(5),
                            fee_owed_b: 150,
                            reward_infos: create_position_reward_infos(
                                340282366920938463460300150086149952853,
                                // 8 = 0.83 * 10
                                8,
                            ),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: 10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(10),
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -20,
                            liquidity_gross: 20,
                            // 15
                            fee_growth_outside_a: to_x64(15),
                            // 15
                            fee_growth_outside_b: to_x64(15),
                            // 0.83
                            reward_growths_outside: create_reward_growths(15372286728091293013),
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint current values
            // Lower tick already initialized, liquidity increase
            // Upper tick initialized, liquidity increase, checkpoint current values
            #[test]
            fn pos_delta_current_tick_above_oo_lower_xo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            fee_growth_checkpoint_a: to_x64(10),
                            fee_growth_checkpoint_b: to_x64(20),
                            reward_infos: create_position_reward_infos(to_x64(3), 0),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 10,
                            liquidity_net: -10,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(3)),
                        },
                    },
                );
            }

            // Position liquidity increase, checkpoint zero values
            // Lower tick already initialized, liquidity increase
            // Upper tick already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_above_oo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            ..Default::default()
                        },
                    },
                );
            }

            // Use non-zero checkpoints for already initialized ticks
            // Position liquidity increase, checkpoint current fee growth inside values
            // Lower tick already initialized, liquidity increase
            // Upper tick already initialized, liquidity increase
            #[test]
            fn pos_delta_current_tick_above_oo_lower_oo_upper_non_zero_checkpoints() {
                // Test fixture is set up to simulate whirlpool at state T1.
                // T0 - current tick inside position, global fees at 10, rewards at 1.
                //    - Some other position already exists using these tick bounds.
                //    - Price gets pushed above upper tick.
                // T1 - current tick above position, global fees at 20, rewards at 2.
                //    - Deposit liquidity into new position.
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(20),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });

                test.whirlpool.reward_last_updated_timestamp = 200;
                test.tick_lower.fee_growth_outside_a = to_x64(10);
                test.tick_lower.fee_growth_outside_b = to_x64(10);
                test.tick_lower.reward_growths_outside = create_reward_growths(to_x64(1));
                test.tick_upper.fee_growth_outside_a = to_x64(20);
                test.tick_upper.fee_growth_outside_b = to_x64(20);
                test.tick_upper.reward_growths_outside = create_reward_growths(to_x64(2));

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    10,
                    300,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 10,
                            fee_growth_checkpoint_a: to_x64(10),
                            fee_growth_checkpoint_b: to_x64(10),
                            reward_infos: create_position_reward_infos(to_x64(1), 0),
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: 20,
                            fee_growth_outside_a: to_x64(10),
                            fee_growth_outside_b: to_x64(10),
                            reward_growths_outside: create_reward_growths(to_x64(1)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_gross: 20,
                            liquidity_net: -20,
                            fee_growth_outside_a: to_x64(20),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(2)),
                        },
                    },
                );
            }
        }
    }

    // Position with positive liquidity transitions to zero liquidity
    // Only possible with negative liquidity delta values
    mod ox_position {

        mod current_tick_below {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            #[test]
            fn neg_delta_current_tick_below_ox_lower_ox_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 100,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate::default(),
                        tick_lower_update: TickUpdate::default(),
                        tick_upper_update: TickUpdate::default(),
                    },
                );
            }

            #[test]
            fn neg_delta_current_tick_below_oo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 100,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 20,
                    tick_upper_liquidity_gross: 20,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate::default(),
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 10,
                            liquidity_gross: 10,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -10,
                            liquidity_gross: 10,
                            ..Default::default()
                        },
                    },
                );
            }

            #[test]
            fn neg_delta_current_tick_below_oo_lower_oo_upper_non_zero_checkpoints() {
                // Test fixture is set up to simulate whirlpool at state T2.
                // T0 - current tick above position, global fees at 100, rewards at 10.
                //    - Deposit liquidity into new position.
                // T1 - current tick inside position, global fees at 150, rewards at 20.
                // T2 - current tick below position, global fees at 200, rewards at 30.
                //    - Remove all liquidity.
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 1000,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 20,
                    tick_upper_liquidity_gross: 20,
                    fee_growth_global_a: to_x64(200),
                    fee_growth_global_b: to_x64(200),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(30)),
                });

                // Time starts at 30_000. Increments of 10_000 seconds with 1000 whirlpool liquidity
                // equate to increments of 10 global rewards.
                test.whirlpool.reward_last_updated_timestamp = 30_000;

                test.tick_lower.reward_growths_outside = create_reward_growths(to_x64(30));
                test.tick_lower.fee_growth_outside_a = to_x64(100);
                test.tick_lower.fee_growth_outside_b = to_x64(100);

                test.tick_upper.reward_growths_outside = create_reward_growths(to_x64(10));
                test.tick_upper.fee_growth_outside_a = to_x64(50);
                test.tick_upper.fee_growth_outside_b = to_x64(50);

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    40_000,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 1000,
                        // 40 = 30 + (10000 / 1000)
                        whirlpool_reward_growths: create_reward_growths(737869762948382064640),
                        position_update: PositionUpdate {
                            liquidity: 0,
                            fee_growth_checkpoint_a: to_x64(50),
                            fee_owed_a: 500,
                            fee_growth_checkpoint_b: to_x64(50),
                            fee_owed_b: 500,
                            reward_infos: create_position_reward_infos(to_x64(20), 200),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 10,
                            liquidity_gross: 10,
                            fee_growth_outside_a: to_x64(100),
                            fee_growth_outside_b: to_x64(100),
                            reward_growths_outside: create_reward_growths(to_x64(30)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -10,
                            liquidity_gross: 10,
                            fee_growth_outside_a: to_x64(50),
                            fee_growth_outside_b: to_x64(50),
                            reward_growths_outside: create_reward_growths(to_x64(10)),
                        },
                    },
                );
            }
        }

        mod current_tick_inside {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            #[test]
            fn neg_delta_current_tick_inside_ox_lower_ox_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 100,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 90,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 0,
                            fee_growth_checkpoint_a: to_x64(10),
                            fee_owed_a: 100,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 200,
                            reward_infos: create_position_reward_infos(to_x64(3), 30),
                        },
                        tick_lower_update: TickUpdate::default(),
                        tick_upper_update: TickUpdate::default(),
                    },
                );
            }

            #[test]
            fn neg_delta_current_tick_inside_oo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 100,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 20,
                    tick_upper_liquidity_gross: 20,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 90,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate {
                            liquidity: 0,
                            fee_growth_checkpoint_a: to_x64(10),
                            fee_owed_a: 100,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 200,
                            reward_infos: create_position_reward_infos(to_x64(3), 30),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 10,
                            liquidity_gross: 10,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -10,
                            liquidity_gross: 10,
                            ..Default::default()
                        },
                    },
                );
            }
        }

        mod current_tick_above {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            #[test]
            fn neg_delta_current_tick_above_ox_lower_ox_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 10,
                    tick_upper_liquidity_gross: 10,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate::default(),
                        tick_lower_update: TickUpdate::default(),
                        tick_upper_update: TickUpdate::default(),
                    },
                );
            }

            #[test]
            fn neg_delta_current_tick_above_oo_lower_oo_upper() {
                let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 100,
                    position_liquidity: 10,
                    tick_lower_liquidity_gross: 20,
                    tick_upper_liquidity_gross: 20,
                    fee_growth_global_a: to_x64(10),
                    fee_growth_global_b: to_x64(20),
                    reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
                });
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    -10,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 100,
                        whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                        position_update: PositionUpdate::default(),
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 10,
                            liquidity_gross: 10,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -10,
                            liquidity_gross: 10,
                            ..Default::default()
                        },
                    },
                );
            }
        }
    }

    // Position with positive liquidity remains in positive liquidity state
    // Only possible with lower and upper ticks that are already initialized (oo, oo)
    mod oo_position {
        use crate::{manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*};

        // Liquidity + tick states remain the same
        // Only fee + reward growth changes
        #[test]
        fn zero_delta_current_tick_below() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                0,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 10,
                        ..Default::default()
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 10,
                        liquidity_gross: 10,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -10,
                        liquidity_gross: 10,
                        ..Default::default()
                    },
                },
            );
        }

        #[test]
        fn zero_delta_current_tick_inside() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Inside,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                0,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 10,
                        fee_growth_checkpoint_a: to_x64(10),
                        fee_owed_a: 100,
                        fee_growth_checkpoint_b: to_x64(20),
                        fee_owed_b: 200,
                        reward_infos: create_position_reward_infos(to_x64(3), 30),
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 10,
                        liquidity_gross: 10,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -10,
                        liquidity_gross: 10,
                        ..Default::default()
                    },
                },
            );
        }

        #[test]
        fn zero_delta_current_tick_above() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Above,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                0,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 10,
                        ..Default::default()
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 10,
                        liquidity_gross: 10,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -10,
                        liquidity_gross: 10,
                        ..Default::default()
                    },
                },
            );
        }

        // Position liquidity increases
        #[test]
        fn pos_delta_current_tick_below() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                10,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 20,
                        ..Default::default()
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 20,
                        liquidity_gross: 20,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -20,
                        liquidity_gross: 20,
                        ..Default::default()
                    },
                },
            );
        }

        #[test]
        fn pos_delta_current_tick_inside() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Inside,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                10,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 110,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 20,
                        fee_growth_checkpoint_a: to_x64(10),
                        fee_owed_a: 100,
                        fee_growth_checkpoint_b: to_x64(20),
                        fee_owed_b: 200,
                        reward_infos: create_position_reward_infos(to_x64(3), 30),
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 20,
                        liquidity_gross: 20,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -20,
                        liquidity_gross: 20,
                        ..Default::default()
                    },
                },
            );
        }

        #[test]
        fn pos_delta_current_tick_above() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Above,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                10,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 20,
                        ..Default::default()
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 20,
                        liquidity_gross: 20,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -20,
                        liquidity_gross: 20,
                        ..Default::default()
                    },
                },
            );
        }

        // Position liquidity decreases by partial amount
        #[test]
        fn neg_delta_current_tick_below() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Below,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -5,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 5,
                        ..Default::default()
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 5,
                        liquidity_gross: 5,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -5,
                        liquidity_gross: 5,
                        ..Default::default()
                    },
                },
            );
        }

        #[test]
        fn neg_delta_current_tick_inside() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Inside,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -5,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 95,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 5,
                        fee_growth_checkpoint_a: to_x64(10),
                        fee_owed_a: 100,
                        fee_growth_checkpoint_b: to_x64(20),
                        fee_owed_b: 200,
                        reward_infos: create_position_reward_infos(to_x64(3), 30),
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 5,
                        liquidity_gross: 5,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -5,
                        liquidity_gross: 5,
                        ..Default::default()
                    },
                },
            );
        }

        #[test]
        fn neg_delta_current_tick_above() {
            let test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Above,
                whirlpool_liquidity: 100,
                position_liquidity: 10,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(10),
                fee_growth_global_b: to_x64(20),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(2)),
            });
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -5,
                100,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 100,
                    whirlpool_reward_growths: create_reward_growths(to_x64(3)),
                    position_update: PositionUpdate {
                        liquidity: 5,
                        ..Default::default()
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_net: 5,
                        liquidity_gross: 5,
                        ..Default::default()
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_net: -5,
                        liquidity_gross: 5,
                        ..Default::default()
                    },
                },
            );
        }
    }

    mod fees_and_rewards {
        use crate::{manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*};

        // Add liquidity to new position, accrue fees and rewards, remove all liquidity.
        // This test checks that accrued fees and rewards are properly accounted even when all
        // liquidity has been removed from a position and the ticks are still initialized.
        #[test]
        fn accrued_tokens_ok_closed_position_ticks_remain_initialized() {
            // Whirlpool with 1000 liquidity, fees (a: 100, b: 200) and reward (20)
            // Lower Tick with 10 liquidity, existing fee checkpoints (a: 10, b: 20) and reward (2)
            // Upper Tick with 10 liquidity, existing fee checkpoints (a: 1, b: 2) and reward (1)
            let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                curr_index_loc: CurrIndex::Inside,
                whirlpool_liquidity: 1000,
                position_liquidity: 0,
                tick_lower_liquidity_gross: 10,
                tick_upper_liquidity_gross: 10,
                fee_growth_global_a: to_x64(100),
                fee_growth_global_b: to_x64(200),
                reward_infos: create_whirlpool_reward_infos(to_x64(1), to_x64(20)),
            });

            test.tick_lower.fee_growth_outside_a = to_x64(10);
            test.tick_lower.fee_growth_outside_b = to_x64(20);
            test.tick_lower.reward_growths_outside = create_reward_growths(to_x64(2));

            test.tick_upper.fee_growth_outside_a = to_x64(1);
            test.tick_upper.fee_growth_outside_b = to_x64(2);
            test.tick_upper.reward_growths_outside = create_reward_growths(to_x64(1));

            // Add 100 liquidity
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                100,
                100,
            )
            .unwrap();

            // 20.1 = 20 + (100 / 1000)
            assert_whirlpool_reward_growths(&update.reward_infos, 370779555881561987481);
            assert_eq!(
                update.position_update,
                PositionUpdate {
                    liquidity: 100,
                    fee_growth_checkpoint_a: to_x64(89), // 100 - 10 - 1
                    fee_growth_checkpoint_b: to_x64(178), // 200 - 20 - 2
                    reward_infos: create_position_reward_infos(315439323660433332633, 0),
                    ..Default::default()
                }
            );
            test.apply_update(&update, 100);

            // Add 50 more liquidity
            test.increment_whirlpool_fee_growths(to_x64(10), to_x64(20));
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                50,
                200,
            )
            .unwrap();

            // 20.19090 = 20.1 + (100 / 1100)
            assert_whirlpool_reward_growths(&update.reward_infos, 372456532615535583082);
            assert_eq!(
                update.position_update,
                PositionUpdate {
                    liquidity: 150,
                    fee_growth_checkpoint_a: to_x64(99), // 110 - 10 - 1
                    fee_owed_a: 1000,
                    fee_growth_checkpoint_b: to_x64(198), // 220 - 20 - 2
                    fee_owed_b: 2000,
                    reward_infos: create_position_reward_infos(317116300394406928234, 9),
                }
            );
            test.apply_update(&update, 200);

            // Remove all 150 liquidity
            test.increment_whirlpool_fee_growths(to_x64(10), to_x64(20));
            let update = _calculate_modify_liquidity(
                &test.whirlpool,
                &test.position,
                &test.tick_lower,
                &test.tick_upper,
                test.position.tick_lower_index,
                test.position.tick_upper_index,
                false,
                false,
                -150,
                300,
            )
            .unwrap();

            assert_modify_liquidity(
                &update,
                &ModifyLiquidityExpectation {
                    whirlpool_liquidity: 1000,
                    // 20.277865 = 20.19090 + (100 / 1150)
                    whirlpool_reward_growths: create_reward_growths(374060597317597283222),
                    position_update: PositionUpdate {
                        liquidity: 0,
                        fee_growth_checkpoint_a: to_x64(109), // 120 - 10 - 1
                        fee_owed_a: 2500,
                        fee_growth_checkpoint_b: to_x64(218), // 240 - 20 - 2
                        fee_owed_b: 5000,
                        reward_infos: create_position_reward_infos(318720365096468628374, 22),
                    },
                    tick_lower_update: TickUpdate {
                        initialized: true,
                        liquidity_gross: 10,
                        liquidity_net: 10,
                        fee_growth_outside_a: to_x64(10),
                        fee_growth_outside_b: to_x64(20),
                        reward_growths_outside: create_reward_growths(to_x64(2)),
                    },
                    tick_upper_update: TickUpdate {
                        initialized: true,
                        liquidity_gross: 10,
                        liquidity_net: -10,
                        fee_growth_outside_a: to_x64(1),
                        fee_growth_outside_b: to_x64(2),
                        reward_growths_outside: create_reward_growths(to_x64(1)),
                    },
                },
            );
        }

        // Test overflow accounting of global fee and reward accumulators
        mod global_accumulators_overflow {
            use crate::{
                manager::liquidity_manager::_calculate_modify_liquidity, state::*, util::*,
            };

            // t1 |---c1---l----------------u--------| open position (checkpoint)
            // t2 |--------l-------c2-------u--------| cross right, accrue tokens
            // t3 |---c3---l----------------u--------| cross left, overflow
            #[test]
            fn overflow_below_checkpoint_below() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 100, rewards at -4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at MAX - 3
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    u128::MAX - to_x64(3),
                );

                // t2 - cross right, accrue tokens in position
                test.cross_tick(TickLabel::Lower, Direction::Right);
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -60
                test.increment_whirlpool_reward_growths_by_time(100); // 300

                // time: 300, rewards at -2.0909
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463424804142550375512621,
                );

                // t3 - cross left, overflow
                test.cross_tick(TickLabel::Lower, Direction::Left);
                test.increment_whirlpool_fee_growths(to_x64(70), to_x64(70)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 0.909 = -2.0909 + 3
                        whirlpool_reward_growths: create_reward_growths(16769767339735956013),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(20),
                            fee_owed_a: 20000,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 20000,
                            reward_infos: create_position_reward_infos(16769767339735956014, 909),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: to_x64(20),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(16769767339735956014), // 0.9090909
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |--------l-------c1-------u--------| open position (checkpoint)
            // t2 |--------l-------c2-------u--------| accrue tokens, cross left
            // t3 |---c3---l----------------u--------| overflow
            #[test]
            fn overflow_below_checkpoint_inside() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 11000,
                        // time: 100, rewards at MAX - 4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);

                // t2 - accrue tokens, cross left
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at MAX - 3.0909
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463406357398476665961005,
                );
                test.cross_tick(TickLabel::Lower, Direction::Left);

                // t3 - overflow
                test.increment_whirlpool_fee_growths(to_x64(90), to_x64(90)); // fees overflow to 10
                test.increment_whirlpool_reward_growths_by_time(400); // 600

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 0.909 = -3.0909 + 4
                        whirlpool_reward_growths: create_reward_growths(16769767339735956013),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(20),
                            fee_owed_a: 20000,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 20000,
                            reward_infos: create_position_reward_infos(16769767339735956014, 909),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: to_x64(20),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(16769767339735956014), // 0.9090909
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |--------l----------------u---c1---| open position (checkpoint), cross left
            // t2 |--------l-------c2-------u--------| accrue tokens, cross left
            // t3 |---c3---l----------------u--------| overflow
            #[test]
            fn overflow_below_checkpoint_above() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 100, rewards at MAX - 4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);

                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at MAX - 3
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    u128::MAX - to_x64(3),
                );
                test.cross_tick(TickLabel::Upper, Direction::Left);

                // t2 - accrue tokens, cross left
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -60
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 300, rewards at MAX - 2.0909
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463424804142550375512621,
                );
                test.cross_tick(TickLabel::Lower, Direction::Left);

                // t3 - overflow
                test.increment_whirlpool_fee_growths(to_x64(70), to_x64(70)); // fees overflow to 10
                test.increment_whirlpool_reward_growths_by_time(300); // 600

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 0.909 = -3.0909 + 4
                        whirlpool_reward_growths: create_reward_growths(16769767339735956013),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(20),
                            fee_owed_a: 20000,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 20000,
                            reward_infos: create_position_reward_infos(16769767339735956014, 909),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: to_x64(40),
                            fee_growth_outside_b: to_x64(40),
                            reward_growths_outside: create_reward_growths(35216511413445507630), // 1.9090909
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: to_x64(20),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(to_x64(1)), // 1
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |---c1---l----------------u--------| open position (checkpoint), cross right
            // t2 |--------l-------c2-------u--------| accrue tokens, overflow
            #[test]
            fn overflow_inside_checkpoint_below() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 100, rewards at MAX - 4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);

                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at MAX - 3
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    u128::MAX - to_x64(3),
                );
                test.cross_tick(TickLabel::Lower, Direction::Right);

                // t2 - accrue tokens, overflow
                test.increment_whirlpool_fee_growths(to_x64(90), to_x64(90)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 11000,
                        // time: 600, rewards at 0.6363 = -3 + (400 * 100 / 11000)
                        whirlpool_reward_growths: create_reward_growths(11738837137815169209),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(90),
                            fee_owed_a: 90000,
                            fee_growth_checkpoint_b: to_x64(90),
                            fee_owed_b: 90000,
                            reward_infos: create_position_reward_infos(67079069358943824058, 3636),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(80),
                            fee_growth_outside_b: u128::MAX - to_x64(80),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(3)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |--------l-------c1-------u--------| open position (checkpoint)
            // t2 |--------l-------c2-------u--------| accrue tokens, overflow
            #[test]
            fn overflow_inside_checkpoint_inside() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 9000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 100, rewards at -3.888 = -5 + (100 * 100 / 9000)
                        whirlpool_reward_growths: create_reward_growths(
                            340282366920938463391637269367342177392,
                        ),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463391637269367342177392,
                            ),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);

                // t2 - accrue tokens, overflow
                test.increment_whirlpool_fee_growths(to_x64(110), to_x64(110)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 1.111 = -3.888 + (500 * 100 / 10000)
                        whirlpool_reward_growths: create_reward_growths(20496382304121724016),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(110),
                            fee_owed_a: 110000,
                            fee_growth_checkpoint_b: to_x64(110),
                            fee_owed_b: 110000,
                            reward_infos: create_position_reward_infos(to_x64(5), 5000),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463391637269367342177392,
                            ),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |--------l----------------u---c1---| open position (checkpoint), cross left
            // t2 |--------l-------c2-------u--------| accrue tokens, overflow
            #[test]
            fn overflow_inside_checkpoint_above() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 9000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 9000,
                        // time: 100, rewards at -3.888 = -5 + (100 * 100 / 9000)
                        whirlpool_reward_growths: create_reward_growths(
                            340282366920938463391637269367342177392,
                        ),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463391637269367342177392,
                            ),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463391637269367342177392,
                            ),
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // -2.777 = -3.888 + (100 * 100 / 9000)
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463412133651671463901409,
                );
                test.cross_tick(TickLabel::Upper, Direction::Left);

                // t2 - accrue tokens, overflow
                test.increment_whirlpool_fee_growths(to_x64(90), to_x64(90)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 1.222 = -2.777 + (400 * 100 / 10000)
                        whirlpool_reward_growths: create_reward_growths(22546020534533896417),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(90),
                            fee_owed_a: 90000,
                            fee_growth_checkpoint_b: to_x64(90),
                            fee_owed_b: 90000,
                            reward_infos: create_position_reward_infos(to_x64(4), 4000),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463391637269367342177392,
                            ),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: to_x64(20),
                            fee_growth_outside_b: to_x64(20),
                            reward_growths_outside: create_reward_growths(20496382304121724017),
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |---c1---l----------------u--------| open position (checkpoint), cross right
            // t2 |--------l-------c2-------u--------| accrue tokens, cross right
            // t3 |--------l----------------u---c3---| overflow
            #[test]
            fn overflow_above_checkpoint_below() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Below,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 100, rewards at -4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at -3
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    u128::MAX - to_x64(3),
                );
                test.cross_tick(TickLabel::Lower, Direction::Right);

                // t2 - accrue tokens, cross right
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -60
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 300, rewards at -2.0909 =
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463424804142550375512621,
                );
                test.cross_tick(TickLabel::Upper, Direction::Right);

                // t3 - overflow
                test.increment_whirlpool_fee_growths(to_x64(70), to_x64(70)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 0.909 = -2.0909 + 3
                        whirlpool_reward_growths: create_reward_growths(16769767339735956013),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            // 20 = 10 - (-80) - (10 - (-60))
                            fee_growth_checkpoint_a: to_x64(20),
                            fee_owed_a: 20000,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 20000,
                            // 0.909 = 0.909 - (-3) - (0.909 - -2.0909)
                            reward_infos: create_position_reward_infos(16769767339735956014, 909),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(80),
                            fee_growth_outside_b: u128::MAX - to_x64(80),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(3)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(60),
                            fee_growth_outside_b: u128::MAX - to_x64(60),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463424804142550375512621,
                            ),
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |--------l-------c1-------u--------| open position (checkpoint)
            // t2 |--------l-------c2-------u--------| accrue tokens, cross right
            // t3 |--------l----------------u---c3---| overflow
            #[test]
            fn overflow_above_checkpoint_inside() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Inside,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 11000,
                        // time: 100, rewards at -4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            ..Default::default()
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);

                // t2 -accrue tokens, cross right
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at MAX - 3.0909
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463406357398476665961005,
                );
                test.cross_tick(TickLabel::Upper, Direction::Right);

                // t3 - overflow
                test.increment_whirlpool_fee_growths(to_x64(90), to_x64(90)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 0.909 = -3.0909 + 4
                        whirlpool_reward_growths: create_reward_growths(16769767339735956013),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            fee_growth_checkpoint_a: to_x64(20),
                            fee_owed_a: 20000,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 20000,
                            reward_infos: create_position_reward_infos(16769767339735956014, 909),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(80),
                            fee_growth_outside_b: u128::MAX - to_x64(80),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463406357398476665961005,
                            ),
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }

            // t1 |--------l----------------u---c1---| open position (checkpoint), cross left
            // t2 |--------l-------c2-------u--------| accrue tokens, cross right
            // t3 |--------l----------------u---c3---| overflow
            #[test]
            fn overflow_above_checkpoint_above() {
                // t1 - open position (checkpoint)
                let mut test = LiquidityTestFixture::new(LiquidityTestFixtureInfo {
                    curr_index_loc: CurrIndex::Above,
                    whirlpool_liquidity: 10000,
                    position_liquidity: 0,
                    tick_lower_liquidity_gross: 0,
                    tick_upper_liquidity_gross: 0,
                    fee_growth_global_a: u128::MAX - to_x64(100),
                    fee_growth_global_b: u128::MAX - to_x64(100),
                    // rewards start at MAX - 5
                    reward_infos: create_whirlpool_reward_infos(to_x64(100), u128::MAX - to_x64(5)),
                });

                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    1000,
                    100,
                )
                .unwrap();

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 100, rewards at -4
                        whirlpool_reward_growths: create_reward_growths(u128::MAX - to_x64(4)),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            ..Default::default()
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                    },
                );
                assert_eq!(test.whirlpool.fee_growth_global_a, u128::MAX - to_x64(100));
                assert_eq!(test.whirlpool.fee_growth_global_b, u128::MAX - to_x64(100));

                test.apply_update(&update, 100);

                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -80
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 200, rewards at MAX - 3
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    u128::MAX - to_x64(3),
                );
                test.cross_tick(TickLabel::Upper, Direction::Left);

                // t2 - accrue tokens, cross right
                test.increment_whirlpool_fee_growths(to_x64(20), to_x64(20)); // fees at -60
                test.increment_whirlpool_reward_growths_by_time(100);
                // time: 300, rewards at MAX - 2.0909
                assert_whirlpool_reward_growths(
                    &test.whirlpool.reward_infos,
                    340282366920938463424804142550375512621,
                );
                test.cross_tick(TickLabel::Upper, Direction::Right);

                // t3 - overflow
                test.increment_whirlpool_fee_growths(to_x64(70), to_x64(70)); // fees overflow to 10

                // Calculate fees and rewards
                let update = _calculate_modify_liquidity(
                    &test.whirlpool,
                    &test.position,
                    &test.tick_lower,
                    &test.tick_upper,
                    test.position.tick_lower_index,
                    test.position.tick_upper_index,
                    false,
                    false,
                    0,
                    600,
                )
                .unwrap();
                test.apply_update(&update, 600);

                assert_modify_liquidity(
                    &update,
                    &ModifyLiquidityExpectation {
                        whirlpool_liquidity: 10000,
                        // time: 600, rewards at 0.909 = -2.0909 + 3
                        whirlpool_reward_growths: create_reward_growths(16769767339735956013),
                        position_update: PositionUpdate {
                            liquidity: 1000,
                            // 20 = 10 - (-100) - (10 - (-80))
                            fee_growth_checkpoint_a: to_x64(20),
                            fee_owed_a: 20000,
                            fee_growth_checkpoint_b: to_x64(20),
                            fee_owed_b: 20000,
                            // 0.909 = 0.909 - (-4) - (0.909 - (-3.0909))
                            reward_infos: create_position_reward_infos(16769767339735956014, 909),
                        },
                        tick_lower_update: TickUpdate {
                            initialized: true,
                            liquidity_net: 1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(100),
                            fee_growth_outside_b: u128::MAX - to_x64(100),
                            reward_growths_outside: create_reward_growths(u128::MAX - to_x64(4)),
                        },
                        tick_upper_update: TickUpdate {
                            initialized: true,
                            liquidity_net: -1000,
                            liquidity_gross: 1000,
                            fee_growth_outside_a: u128::MAX - to_x64(80),
                            fee_growth_outside_b: u128::MAX - to_x64(80),
                            reward_growths_outside: create_reward_growths(
                                340282366920938463406357398476665961005,
                            ),
                        },
                    },
                );
                // 10
                assert_eq!(test.whirlpool.fee_growth_global_a, 184467440737095516159);
                assert_eq!(test.whirlpool.fee_growth_global_b, 184467440737095516159);
            }
        }
    }
}
