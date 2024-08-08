use crate::{
    errors::ErrorCode,
    math::{add_liquidity_delta, checked_mul_shift_right},
    state::{Position, PositionUpdate, NUM_REWARDS},
};

pub fn next_position_modify_liquidity_update(
    position: &Position,
    liquidity_delta: i128,
    fee_growth_inside_a: u128,
    fee_growth_inside_b: u128,
    reward_growths_inside: &[u128; NUM_REWARDS],
) -> Result<PositionUpdate, ErrorCode> {
    let mut update = PositionUpdate::default();

    // Calculate fee deltas.
    // If fee deltas overflow, default to a zero value. This means the position loses
    // all fees earned since the last time the position was modified or fees collected.
    let growth_delta_a = fee_growth_inside_a.wrapping_sub(position.fee_growth_checkpoint_a);
    let fee_delta_a = checked_mul_shift_right(position.liquidity, growth_delta_a).unwrap_or(0);

    let growth_delta_b = fee_growth_inside_b.wrapping_sub(position.fee_growth_checkpoint_b);
    let fee_delta_b = checked_mul_shift_right(position.liquidity, growth_delta_b).unwrap_or(0);

    update.fee_growth_checkpoint_a = fee_growth_inside_a;
    update.fee_growth_checkpoint_b = fee_growth_inside_b;

    // Overflows allowed. Must collect fees owed before overflow.
    update.fee_owed_a = position.fee_owed_a.wrapping_add(fee_delta_a);
    update.fee_owed_b = position.fee_owed_b.wrapping_add(fee_delta_b);

    for (i, update) in update.reward_infos.iter_mut().enumerate() {
        let reward_growth_inside = reward_growths_inside[i];
        let curr_reward_info = position.reward_infos[i];

        // Calculate reward delta.
        // If reward delta overflows, default to a zero value. This means the position loses all
        // rewards earned since the last time the position was modified or rewards were collected.
        let reward_growth_delta =
            reward_growth_inside.wrapping_sub(curr_reward_info.growth_inside_checkpoint);
        let amount_owed_delta =
            checked_mul_shift_right(position.liquidity, reward_growth_delta).unwrap_or(0);

        update.growth_inside_checkpoint = reward_growth_inside;

        // Overflows allowed. Must collect rewards owed before overflow.
        update.amount_owed = curr_reward_info.amount_owed.wrapping_add(amount_owed_delta);
    }

    update.liquidity = add_liquidity_delta(position.liquidity, liquidity_delta)?;

    Ok(update)
}

#[cfg(test)]
mod position_manager_unit_tests {
    use crate::{
        math::{add_liquidity_delta, Q64_RESOLUTION},
        state::{position_builder::PositionBuilder, Position, PositionRewardInfo, NUM_REWARDS},
    };

    use super::next_position_modify_liquidity_update;

    #[test]
    fn ok_positive_liquidity_delta_fee_growth() {
        let position = PositionBuilder::new(-10, 10)
            .liquidity(0)
            .fee_owed_a(10)
            .fee_owed_b(500)
            .fee_growth_checkpoint_a(100 << Q64_RESOLUTION)
            .fee_growth_checkpoint_b(100 << Q64_RESOLUTION)
            .build();
        let update = next_position_modify_liquidity_update(
            &position,
            1000,
            1000 << Q64_RESOLUTION,
            2000 << Q64_RESOLUTION,
            &[0, 0, 0],
        )
        .unwrap();

        assert_eq!(update.liquidity, 1000);
        assert_eq!(update.fee_growth_checkpoint_a, 1000 << Q64_RESOLUTION);
        assert_eq!(update.fee_growth_checkpoint_b, 2000 << Q64_RESOLUTION);
        assert_eq!(update.fee_owed_a, 10);
        assert_eq!(update.fee_owed_b, 500);

        for i in 0..NUM_REWARDS {
            assert_eq!(update.reward_infos[i].amount_owed, 0);
            assert_eq!(update.reward_infos[i].growth_inside_checkpoint, 0);
        }
    }

    #[test]
    fn ok_negative_liquidity_delta_fee_growth() {
        let position = PositionBuilder::new(-10, 10)
            .liquidity(10000)
            .fee_growth_checkpoint_a(100 << Q64_RESOLUTION)
            .fee_growth_checkpoint_b(100 << Q64_RESOLUTION)
            .build();
        let update = next_position_modify_liquidity_update(
            &position,
            -5000,
            120 << Q64_RESOLUTION,
            250 << Q64_RESOLUTION,
            &[0, 0, 0],
        )
        .unwrap();

        assert_eq!(update.liquidity, 5000);
        assert_eq!(update.fee_growth_checkpoint_a, 120 << Q64_RESOLUTION);
        assert_eq!(update.fee_growth_checkpoint_b, 250 << Q64_RESOLUTION);
        assert_eq!(update.fee_owed_a, 200_000);
        assert_eq!(update.fee_owed_b, 1_500_000);

        for i in 0..NUM_REWARDS {
            assert_eq!(update.reward_infos[i].amount_owed, 0);
            assert_eq!(update.reward_infos[i].growth_inside_checkpoint, 0);
        }
    }

    #[test]
    #[should_panic(expected = "LiquidityUnderflow")]
    fn liquidity_underflow() {
        let position = PositionBuilder::new(-10, 10).build();
        next_position_modify_liquidity_update(&position, -100, 0, 0, &[0, 0, 0]).unwrap();
    }

    #[test]
    #[should_panic(expected = "LiquidityOverflow")]
    fn liquidity_overflow() {
        let position = PositionBuilder::new(-10, 10).liquidity(u128::MAX).build();
        next_position_modify_liquidity_update(&position, i128::MAX, 0, 0, &[0, 0, 0]).unwrap();
    }

    #[test]
    fn fee_delta_overflow_defaults_zero() {
        let position = PositionBuilder::new(-10, 10)
            .liquidity(i64::MAX as u128)
            .fee_owed_a(10)
            .fee_owed_b(20)
            .build();
        let update = next_position_modify_liquidity_update(
            &position,
            i64::MAX as i128,
            u128::MAX,
            u128::MAX,
            &[0, 0, 0],
        )
        .unwrap();
        assert_eq!(update.fee_growth_checkpoint_a, u128::MAX);
        assert_eq!(update.fee_growth_checkpoint_b, u128::MAX);
        assert_eq!(update.fee_owed_a, 10);
        assert_eq!(update.fee_owed_b, 20);
    }

    #[test]
    fn ok_reward_growth() {
        struct Test<'a> {
            name: &'a str,
            position: &'a Position,
            liquidity_delta: i128,
            reward_growths_inside: [u128; NUM_REWARDS],
            expected_reward_infos: [PositionRewardInfo; NUM_REWARDS],
        }

        let position = &PositionBuilder::new(-10, 10)
            .liquidity(2500)
            .reward_infos([
                PositionRewardInfo {
                    growth_inside_checkpoint: 100 << Q64_RESOLUTION,
                    amount_owed: 50,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 250 << Q64_RESOLUTION,
                    amount_owed: 100,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 10 << Q64_RESOLUTION,
                    amount_owed: 0,
                },
            ])
            .build();

        for test in [
            Test {
                name: "all initialized reward growths update",
                position,
                liquidity_delta: 2500,
                reward_growths_inside: [
                    200 << Q64_RESOLUTION,
                    500 << Q64_RESOLUTION,
                    1000 << Q64_RESOLUTION,
                ],
                expected_reward_infos: [
                    PositionRewardInfo {
                        growth_inside_checkpoint: 200 << Q64_RESOLUTION,
                        amount_owed: 250_050,
                    },
                    PositionRewardInfo {
                        growth_inside_checkpoint: 500 << Q64_RESOLUTION,
                        amount_owed: 625_100,
                    },
                    PositionRewardInfo {
                        growth_inside_checkpoint: 1000 << Q64_RESOLUTION,
                        amount_owed: 2_475_000,
                    },
                ],
            },
            Test {
                name: "reward delta overflow defaults to zero",
                position: &PositionBuilder::new(-10, 10)
                    .liquidity(i64::MAX as u128)
                    .reward_infos([
                        PositionRewardInfo {
                            ..Default::default()
                        },
                        PositionRewardInfo {
                            amount_owed: 100,
                            ..Default::default()
                        },
                        PositionRewardInfo {
                            amount_owed: 200,
                            ..Default::default()
                        },
                    ])
                    .build(),
                liquidity_delta: 2500,
                reward_growths_inside: [u128::MAX, 500 << Q64_RESOLUTION, 1000 << Q64_RESOLUTION],
                expected_reward_infos: [
                    PositionRewardInfo {
                        growth_inside_checkpoint: u128::MAX,
                        amount_owed: 0,
                    },
                    PositionRewardInfo {
                        growth_inside_checkpoint: 500 << Q64_RESOLUTION,
                        amount_owed: 100,
                    },
                    PositionRewardInfo {
                        growth_inside_checkpoint: 1000 << Q64_RESOLUTION,
                        amount_owed: 200,
                    },
                ],
            },
        ] {
            let update = next_position_modify_liquidity_update(
                test.position,
                test.liquidity_delta,
                0,
                0,
                &test.reward_growths_inside,
            )
            .unwrap();
            assert_eq!(
                update.liquidity,
                add_liquidity_delta(test.position.liquidity, test.liquidity_delta).unwrap(),
                "{} - assert liquidity delta",
                test.name,
            );
            for i in 0..NUM_REWARDS {
                assert_eq!(
                    update.reward_infos[i].growth_inside_checkpoint,
                    test.expected_reward_infos[i].growth_inside_checkpoint,
                    "{} - assert growth_inside_checkpoint",
                    test.name,
                );
                assert_eq!(
                    update.reward_infos[i].amount_owed, test.expected_reward_infos[i].amount_owed,
                    "{} - assert amount_owed",
                    test.name
                );
            }
        }
    }

    #[test]
    fn reward_delta_overflow_defaults_zero() {
        let position = PositionBuilder::new(-10, 10)
            .liquidity(i64::MAX as u128)
            .reward_infos([
                PositionRewardInfo {
                    growth_inside_checkpoint: 100,
                    amount_owed: 1000,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 100,
                    amount_owed: 1000,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 100,
                    amount_owed: 1000,
                },
            ])
            .build();
        let update = next_position_modify_liquidity_update(
            &position,
            i64::MAX as i128,
            0,
            0,
            &[u128::MAX, u128::MAX, u128::MAX],
        )
        .unwrap();
        assert_eq!(
            update.reward_infos,
            [
                PositionRewardInfo {
                    growth_inside_checkpoint: u128::MAX,
                    amount_owed: 1000,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: u128::MAX,
                    amount_owed: 1000,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: u128::MAX,
                    amount_owed: 1000,
                },
            ]
        )
    }
}
