use crate::{
    errors::ErrorCode,
    math::{add_liquidity_delta, checked_mul_shift_right, Q64_RESOLUTION},
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

    // increase/decrease liquidity instruction requires that liquidity_delta != 0
    let checkpoint_update_mode = if liquidity_delta == 0 {
        // update fees and rewards context
        CheckpointUpdateMode::Partial
    } else {
        // increase/decrease liquidity context
        CheckpointUpdateMode::Full
    };

    // Calculate fee deltas.
    let (fee_delta_a, next_checkpoint_a) = next_owed_delta_and_checkpoint(
        fee_growth_inside_a,
        position.fee_growth_checkpoint_a,
        position.liquidity,
        checkpoint_update_mode,
    );
    let (fee_delta_b, next_checkpoint_b) = next_owed_delta_and_checkpoint(
        fee_growth_inside_b,
        position.fee_growth_checkpoint_b,
        position.liquidity,
        checkpoint_update_mode,
    );

    update.fee_growth_checkpoint_a = next_checkpoint_a;
    update.fee_growth_checkpoint_b = next_checkpoint_b;

    // Overflows allowed. Must collect fees owed before overflow.
    update.fee_owed_a = position.fee_owed_a.wrapping_add(fee_delta_a);
    update.fee_owed_b = position.fee_owed_b.wrapping_add(fee_delta_b);

    for (i, update) in update.reward_infos.iter_mut().enumerate() {
        let reward_growth_inside = reward_growths_inside[i];
        let curr_reward_info = position.reward_infos[i];

        // Calculate reward delta.
        let (amount_owed_delta, next_checkpoint) = next_owed_delta_and_checkpoint(
            reward_growth_inside,
            curr_reward_info.growth_inside_checkpoint,
            position.liquidity,
            checkpoint_update_mode,
        );

        update.growth_inside_checkpoint = next_checkpoint;

        // Overflows allowed. Must collect rewards owed before overflow.
        update.amount_owed = curr_reward_info.amount_owed.wrapping_add(amount_owed_delta);
    }

    update.liquidity = add_liquidity_delta(position.liquidity, liquidity_delta)?;

    Ok(update)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointUpdateMode {
    // Advances the checkpoint only for growth converted into owed amount.
    Partial,
    // Advances the checkpoint fully to growth_inside.
    // Required before changing the position liquidity.
    Full,
}

pub fn next_owed_delta_and_checkpoint(
    growth_inside: u128,
    current_checkpoint: u128,
    position_liquidity: u128,
    checkpoint_update_mode: CheckpointUpdateMode,
) -> (u64, u128) {
    let growth_delta = growth_inside.wrapping_sub(current_checkpoint);
    let Ok(owed_delta) = checked_mul_shift_right(position_liquidity, growth_delta) else {
        // If the fee/reward delta overflows, default the owed delta to zero.
        // This means the position loses all fees/rewards earned since the last time
        // the position was modified or fees/rewards were collected.
        return (0, growth_inside);
    };

    if checkpoint_update_mode == CheckpointUpdateMode::Full {
        return (owed_delta, growth_inside);
    }

    if owed_delta == 0 {
        return (0, current_checkpoint);
    }

    // Note: owed_delta > 0 ensures that position_liquidity > 0
    let converted_growth_delta =
        ((owed_delta as u128) << Q64_RESOLUTION).div_ceil(position_liquidity);
    let next_checkpoint = current_checkpoint.wrapping_add(converted_growth_delta);

    (owed_delta, next_checkpoint)
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

#[cfg(test)]
mod next_owed_delta_and_checkpoint_tests {
    use super::*;

    fn x64(value: u128) -> u128 {
        value << Q64_RESOLUTION
    }

    struct TestNextOwedDeltaAndCheckpointParams {
        update_mode: CheckpointUpdateMode,
        growth_inside: u128,
        current_checkpoint: u128,
        position_liquidity: u128,
        expected_owed: u64,
        expected_next_checkpoint: u128,
    }

    impl TestNextOwedDeltaAndCheckpointParams {
        fn run(&self) {
            let (owed, next_checkpoint) = next_owed_delta_and_checkpoint(
                self.growth_inside,
                self.current_checkpoint,
                self.position_liquidity,
                self.update_mode,
            );
            assert_eq!(owed, self.expected_owed);
            assert_eq!(next_checkpoint, self.expected_next_checkpoint);
        }
    }

    mod full_mode {
        use super::*;

        // growth_inside = checkpoint
        #[test]
        fn no_growth() {
            let growth_inside = 1000;
            let current_checkpoint = growth_inside;

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity: 1000,
                expected_owed: 0,
                expected_next_checkpoint: current_checkpoint,
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 0.x
        #[test]
        fn inside_gt_checkpoint_owed_0x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(9) / 10; // ~0.9
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 1.0 (exact)
        #[test]
        fn inside_gt_checkpoint_owed_1_exact() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(1); // 1.0
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 1.x (< 1.5)
        #[test]
        fn inside_gt_checkpoint_owed_1x_low() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(12) / 10; // 1.2
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 1.x (> 1.5)
        #[test]
        fn inside_gt_checkpoint_owed_1x_high() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(18) / 10; // 1.8
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 2.x
        #[test]
        fn inside_gt_checkpoint_owed_2x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(25) / 10; // 2.5
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 2,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 382949173.928
        #[test]
        fn inside_gt_checkpoint_owed_382949173x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 382949173,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside < checkpoint (wrapping): owed = 0.x
        #[test]
        fn inside_lt_checkpoint_owed_0x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = u128::MAX;
            let owed_x64 = x64(9) / 10; // ~0.9
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside < checkpoint (wrapping): owed = 1.x (< 1.5)
        #[test]
        fn inside_lt_checkpoint_owed_1x_low() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = u128::MAX;
            let owed_x64 = x64(12) / 10; // 1.2
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        // growth_inside < checkpoint (wrapping): owed = 382949173.928
        #[test]
        fn inside_lt_checkpoint_owed_382949173x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = u128::MAX;
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 382949173,
                expected_next_checkpoint: growth_inside, // Full
            }
            .run();
        }

        #[test]
        fn zero_position_liquidity() {
            let position_liquidity = 0;
            let growth_inside = x64(3);
            let current_checkpoint = x64(1);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: growth_inside,
            }
            .run();
        }

        #[test]
        fn growth_delta_x_position_liquidity_overflow() {
            let position_liquidity = 1u128 << 65;
            let growth_inside = 1u128 << 68;
            let current_checkpoint = x64(1);

            // should overflow
            let growth_delta = growth_inside.checked_sub(current_checkpoint).unwrap();
            assert!(growth_delta.checked_mul(position_liquidity).is_none());

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Full,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: growth_inside,
            }
            .run();
        }

        // Repeated Full updates must drop sub-unit growth.
        #[test]
        fn repeated_full_updates_accumulate_fractional_growth() {
            let position_liquidity = 1 << 10;
            let mut current_checkpoint = x64(1);
            let mut growth_inside = current_checkpoint;

            // Each update adds approximately 0.2001 owed units.
            // A single update therefore cannot produce an owed amount.
            let owed_x64_per_update = x64(2001) / 10000; // ~0.2001
            let growth_delta_per_update = owed_x64_per_update / position_liquidity;

            for _ in 0..10 {
                growth_inside = growth_inside.wrapping_add(growth_delta_per_update);

                let (owed, next_checkpoint) = next_owed_delta_and_checkpoint(
                    growth_inside,
                    current_checkpoint,
                    position_liquidity,
                    CheckpointUpdateMode::Full,
                );

                assert_eq!(owed, 0);
                assert!(next_checkpoint > current_checkpoint); // fractional growth is dropped

                current_checkpoint = next_checkpoint;
            }
        }
    }

    mod partial_mode {
        use super::*;

        // growth_inside = checkpoint
        #[test]
        fn no_growth() {
            let growth_inside = 1000;
            let current_checkpoint = growth_inside;

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity: 1000,
                expected_owed: 0,
                expected_next_checkpoint: current_checkpoint,
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 0.x
        #[test]
        fn inside_gt_checkpoint_owed_0x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(9) / 10; // ~0.9
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: current_checkpoint, // no change
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 1.0 (exact)
        #[test]
        fn inside_gt_checkpoint_owed_1_exact() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(1); // 1.0
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: growth_inside, // consumed all growth
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 1.x (< 1.5)
        #[test]
        fn inside_gt_checkpoint_owed_1x_low() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(12) / 10; // 1.2
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: current_checkpoint
                    .wrapping_add(x64(1).div_ceil(position_liquidity)), // Partial
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 1.x (> 1.5)
        #[test]
        fn inside_gt_checkpoint_owed_1x_high() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(18) / 10; // 1.8
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: current_checkpoint
                    .wrapping_add(x64(1).div_ceil(position_liquidity)), // Partial
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 2.x
        #[test]
        fn inside_gt_checkpoint_owed_2x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(25) / 10; // 2.5
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 2,
                expected_next_checkpoint: current_checkpoint
                    .wrapping_add(x64(2).div_ceil(position_liquidity)), // Partial
            }
            .run();
        }

        // growth_inside > checkpoint: owed = 382949173.928
        #[test]
        fn inside_gt_checkpoint_owed_382949173x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 382949173,
                expected_next_checkpoint: current_checkpoint
                    .wrapping_add(x64(382949173).div_ceil(position_liquidity)), // Partial
            }
            .run();
        }

        // growth_inside < checkpoint (wrapping): owed = 0.x
        #[test]
        fn inside_lt_checkpoint_owed_0x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = u128::MAX;
            let owed_x64 = x64(9) / 10; // ~0.9
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: current_checkpoint, // no change
            }
            .run();
        }

        // growth_inside < checkpoint (wrapping): owed = 1.x (< 1.5)
        #[test]
        fn inside_lt_checkpoint_owed_1x_low() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = u128::MAX;
            let owed_x64 = x64(12) / 10; // 1.2
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 1,
                expected_next_checkpoint: current_checkpoint
                    .wrapping_add(x64(1).div_ceil(position_liquidity)), // Partial
            }
            .run();
        }

        // growth_inside < checkpoint (wrapping): owed = 382949173.928
        #[test]
        fn inside_lt_checkpoint_owed_382949173x() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = u128::MAX;
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 382949173,
                expected_next_checkpoint: current_checkpoint
                    .wrapping_add(x64(382949173).div_ceil(position_liquidity)), // Partial
            }
            .run();
        }

        #[test]
        fn zero_position_liquidity() {
            let position_liquidity = 0;
            let growth_inside = x64(3);
            let current_checkpoint = x64(1);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: current_checkpoint, // no change
            }
            .run();
        }

        #[test]
        fn growth_delta_x_position_liquidity_overflow() {
            let position_liquidity = 1u128 << 65;
            let growth_inside = 1u128 << 68;
            let current_checkpoint = x64(1);

            // should overflow
            let growth_delta = growth_inside.checked_sub(current_checkpoint).unwrap();
            assert!(growth_delta.checked_mul(position_liquidity).is_none());

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: growth_inside, // when overflow occurs, same to full checkpoint
            }
            .run();
        }

        // div_ceil must be used for converted_growth_delta
        #[test]
        fn test_converted_growth_delta_div_ceil() {
            let position_liquidity = 1000;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            let div_ceil = x64(382949173).div_ceil(position_liquidity);
            let div_floor = x64(382949173) / position_liquidity;
            assert!(div_ceil > div_floor);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 382949173,
                expected_next_checkpoint: current_checkpoint.wrapping_add(div_ceil), // Partial
            }
            .run();
        }

        // converted_growth_delta is exactly divisible by position_liquidity.
        // div_ceil and normal division must produce the same result.
        #[test]
        fn test_converted_growth_delta_div_ceil_exact() {
            let position_liquidity = 1 << 10;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(2); // exactly 2.0
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            let div_ceil = x64(2).div_ceil(position_liquidity);
            let div_floor = x64(2) / position_liquidity;
            assert_eq!(div_ceil, div_floor);

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 2,
                expected_next_checkpoint: current_checkpoint.wrapping_add(div_ceil),
            }
            .run();
        }

        // Same growth must not be paid twice.
        // div_ceil ensures that all growth corresponding to the already-paid owed amount
        // is consumed by the first update.
        #[test]
        fn same_growth_cannot_be_paid_twice() {
            let position_liquidity = 1000;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            let (owed, next_checkpoint) = next_owed_delta_and_checkpoint(
                growth_inside,
                current_checkpoint,
                position_liquidity,
                CheckpointUpdateMode::Partial,
            );

            assert_eq!(owed, 382949173);
            assert_eq!(
                next_checkpoint,
                current_checkpoint.wrapping_add(x64(382949173).div_ceil(position_liquidity))
            );

            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint: next_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: next_checkpoint, // no additional growth
            }
            .run();
        }

        // After a Partial update, the remaining growth must not be sufficient to
        // produce another unit of owed amount.
        #[test]
        fn remaining_growth_cannot_produce_additional_owed() {
            let position_liquidity = 1000;
            let current_checkpoint = x64(1);
            let owed_x64 = x64(382949173928) / 1000; // 382949173.928
            let growth_inside = current_checkpoint.wrapping_add(owed_x64 / position_liquidity);

            let (owed, next_checkpoint) = next_owed_delta_and_checkpoint(
                growth_inside,
                current_checkpoint,
                position_liquidity,
                CheckpointUpdateMode::Partial,
            );

            assert_eq!(owed, 382949173);

            let remaining_growth = growth_inside.wrapping_sub(next_checkpoint);
            let remaining_owed =
                checked_mul_shift_right(position_liquidity, remaining_growth).unwrap();

            assert_eq!(remaining_owed, 0);
        }

        // Repeated Partial updates must preserve sub-unit growth until it accumulates
        // enough to produce an owed amount.
        #[test]
        fn repeated_partial_updates_accumulate_fractional_growth() {
            let position_liquidity = 1 << 10;
            let mut current_checkpoint = x64(1);
            let mut growth_inside = current_checkpoint;

            // Each update adds approximately 0.2001 owed units.
            // A single update therefore cannot produce an owed amount.
            let owed_x64_per_update = x64(2001) / 10000; // ~0.2001
            let growth_delta_per_update = owed_x64_per_update / position_liquidity;

            for _ in 0..4 {
                growth_inside = growth_inside.wrapping_add(growth_delta_per_update);

                let (owed, next_checkpoint) = next_owed_delta_and_checkpoint(
                    growth_inside,
                    current_checkpoint,
                    position_liquidity,
                    CheckpointUpdateMode::Partial,
                );

                assert_eq!(owed, 0);
                assert_eq!(next_checkpoint, current_checkpoint); // fractional growth is preserved
            }

            // After enough updates, the accumulated growth should produce an owed amount.
            growth_inside = growth_inside.wrapping_add(growth_delta_per_update);

            let (owed, next_checkpoint) = next_owed_delta_and_checkpoint(
                growth_inside,
                current_checkpoint,
                position_liquidity,
                CheckpointUpdateMode::Partial,
            );

            assert_eq!(owed, 1);

            current_checkpoint = next_checkpoint;

            // Without additional growth, calling again must not pay the same amount twice.
            TestNextOwedDeltaAndCheckpointParams {
                update_mode: CheckpointUpdateMode::Partial,
                growth_inside,
                current_checkpoint,
                position_liquidity,
                expected_owed: 0,
                expected_next_checkpoint: current_checkpoint,
            }
            .run();
        }
    }
}
