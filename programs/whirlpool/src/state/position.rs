use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, math::FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD, state::NUM_REWARDS};

use super::{Tick, Whirlpool};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy)]
pub struct OpenPositionBumps {
    pub position_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy)]
pub struct OpenPositionWithMetadataBumps {
    pub position_bump: u8,
    pub metadata_bump: u8,
}

#[account]
#[derive(Default)]
pub struct Position {
    pub whirlpool: Pubkey,     // 32
    pub position_mint: Pubkey, // 32
    pub liquidity: u128,       // 16
    pub tick_lower_index: i32, // 4
    pub tick_upper_index: i32, // 4

    // Q64.64
    pub fee_growth_checkpoint_a: u128, // 16
    pub fee_owed_a: u64,               // 8
    // Q64.64
    pub fee_growth_checkpoint_b: u128, // 16
    pub fee_owed_b: u64,               // 8

    pub reward_infos: [PositionRewardInfo; NUM_REWARDS], // 72
}

impl Position {
    pub const LEN: usize = 8 + 136 + 72;

    pub fn is_position_empty<'info>(position: &Position) -> bool {
        let fees_not_owed = position.fee_owed_a == 0 && position.fee_owed_b == 0;
        let mut rewards_not_owed = true;
        for i in 0..NUM_REWARDS {
            rewards_not_owed = rewards_not_owed && position.reward_infos[i].amount_owed == 0
        }
        position.liquidity == 0 && fees_not_owed && rewards_not_owed
    }

    pub fn update(&mut self, update: &PositionUpdate) {
        self.liquidity = update.liquidity;
        self.fee_growth_checkpoint_a = update.fee_growth_checkpoint_a;
        self.fee_growth_checkpoint_b = update.fee_growth_checkpoint_b;
        self.fee_owed_a = update.fee_owed_a;
        self.fee_owed_b = update.fee_owed_b;
        self.reward_infos = update.reward_infos;
    }

    pub fn open_position(
        &mut self,
        whirlpool: &Account<Whirlpool>,
        position_mint: Pubkey,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> Result<()> {
        if !Tick::check_is_usable_tick(tick_lower_index, whirlpool.tick_spacing)
            || !Tick::check_is_usable_tick(tick_upper_index, whirlpool.tick_spacing)
            || tick_lower_index >= tick_upper_index
        {
            return Err(ErrorCode::InvalidTickIndex.into());
        }

        // On tick spacing >= 2^15, should only be able to open full range positions
        if whirlpool.tick_spacing >= FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD {
            let (full_range_lower_index, full_range_upper_index) = Tick::full_range_indexes(whirlpool.tick_spacing);
            if tick_lower_index != full_range_lower_index
                || tick_upper_index != full_range_upper_index
            {
                return Err(ErrorCode::FullRangeOnlyPool.into());
            }
        }

        self.whirlpool = whirlpool.key();
        self.position_mint = position_mint;

        self.tick_lower_index = tick_lower_index;
        self.tick_upper_index = tick_upper_index;
        Ok(())
    }

    pub fn reset_fees_owed(&mut self) {
        self.fee_owed_a = 0;
        self.fee_owed_b = 0;
    }

    pub fn update_reward_owed(&mut self, index: usize, amount_owed: u64) {
        self.reward_infos[index].amount_owed = amount_owed;
    }
}

#[derive(Copy, Clone, AnchorSerialize, AnchorDeserialize, Default, Debug, PartialEq)]
pub struct PositionRewardInfo {
    // Q64.64
    pub growth_inside_checkpoint: u128,
    pub amount_owed: u64,
}

#[derive(Default, Debug, PartialEq)]
pub struct PositionUpdate {
    pub liquidity: u128,
    pub fee_growth_checkpoint_a: u128,
    pub fee_owed_a: u64,
    pub fee_growth_checkpoint_b: u128,
    pub fee_owed_b: u64,
    pub reward_infos: [PositionRewardInfo; NUM_REWARDS],
}

#[cfg(test)]
mod is_position_empty_tests {
    use super::*;
    use crate::constants::test_constants::*;

    pub fn build_test_position(
        liquidity: u128,
        fee_owed_a: u64,
        fee_owed_b: u64,
        reward_owed_0: u64,
        reward_owed_1: u64,
        reward_owed_2: u64,
    ) -> Position {
        Position {
            whirlpool: test_program_id(),
            position_mint: test_program_id(),
            liquidity,
            tick_lower_index: 0,
            tick_upper_index: 0,
            fee_growth_checkpoint_a: 0,
            fee_owed_a,
            fee_growth_checkpoint_b: 0,
            fee_owed_b,
            reward_infos: [
                PositionRewardInfo {
                    growth_inside_checkpoint: 0,
                    amount_owed: reward_owed_0,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 0,
                    amount_owed: reward_owed_1,
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 0,
                    amount_owed: reward_owed_2,
                },
            ],
        }
    }

    #[test]
    fn test_position_empty() {
        let pos = build_test_position(0, 0, 0, 0, 0, 0);
        assert_eq!(Position::is_position_empty(&pos), true);
    }

    #[test]
    fn test_liquidity_non_zero() {
        let pos = build_test_position(100, 0, 0, 0, 0, 0);
        assert_eq!(Position::is_position_empty(&pos), false);
    }

    #[test]
    fn test_fee_a_non_zero() {
        let pos = build_test_position(0, 100, 0, 0, 0, 0);
        assert_eq!(Position::is_position_empty(&pos), false);
    }

    #[test]
    fn test_fee_b_non_zero() {
        let pos = build_test_position(0, 0, 100, 0, 0, 0);
        assert_eq!(Position::is_position_empty(&pos), false);
    }

    #[test]
    fn test_reward_0_non_zero() {
        let pos = build_test_position(0, 0, 0, 100, 0, 0);
        assert_eq!(Position::is_position_empty(&pos), false);
    }

    #[test]
    fn test_reward_1_non_zero() {
        let pos = build_test_position(0, 0, 0, 0, 100, 0);
        assert_eq!(Position::is_position_empty(&pos), false);
    }

    #[test]
    fn test_reward_2_non_zero() {
        let pos = build_test_position(0, 0, 0, 0, 0, 100);
        assert_eq!(Position::is_position_empty(&pos), false);
    }
}

#[cfg(test)]
pub mod position_builder {
    use anchor_lang::prelude::Pubkey;

    use super::{Position, PositionRewardInfo};
    use crate::state::NUM_REWARDS;

    #[derive(Default)]
    pub struct PositionBuilder {
        liquidity: u128,

        tick_lower_index: i32,
        tick_upper_index: i32,

        // Q64.64
        fee_growth_checkpoint_a: u128,
        fee_owed_a: u64,
        // Q64.64
        fee_growth_checkpoint_b: u128,
        fee_owed_b: u64,

        // Size should equal state::NUM_REWARDS
        reward_infos: [PositionRewardInfo; NUM_REWARDS],
    }

    impl PositionBuilder {
        pub fn new(tick_lower_index: i32, tick_upper_index: i32) -> Self {
            Self {
                tick_lower_index,
                tick_upper_index,
                reward_infos: [PositionRewardInfo::default(); NUM_REWARDS],
                ..Default::default()
            }
        }

        pub fn liquidity(mut self, liquidity: u128) -> Self {
            self.liquidity = liquidity;
            self
        }

        pub fn fee_growth_checkpoint_a(mut self, fee_growth_checkpoint_a: u128) -> Self {
            self.fee_growth_checkpoint_a = fee_growth_checkpoint_a;
            self
        }

        pub fn fee_growth_checkpoint_b(mut self, fee_growth_checkpoint_b: u128) -> Self {
            self.fee_growth_checkpoint_b = fee_growth_checkpoint_b;
            self
        }

        pub fn fee_owed_a(mut self, fee_owed_a: u64) -> Self {
            self.fee_owed_a = fee_owed_a;
            self
        }

        pub fn fee_owed_b(mut self, fee_owed_b: u64) -> Self {
            self.fee_owed_b = fee_owed_b;
            self
        }

        pub fn reward_info(mut self, index: usize, reward_info: PositionRewardInfo) -> Self {
            self.reward_infos[index] = reward_info;
            self
        }

        pub fn reward_infos(mut self, reward_infos: [PositionRewardInfo; NUM_REWARDS]) -> Self {
            self.reward_infos = reward_infos;
            self
        }

        pub fn build(self) -> Position {
            Position {
                whirlpool: Pubkey::new_unique(),
                position_mint: Pubkey::new_unique(),
                liquidity: self.liquidity,
                fee_growth_checkpoint_a: self.fee_growth_checkpoint_a,
                fee_growth_checkpoint_b: self.fee_growth_checkpoint_b,
                fee_owed_a: self.fee_owed_a,
                fee_owed_b: self.fee_owed_b,
                reward_infos: self.reward_infos,
                tick_lower_index: self.tick_lower_index,
                tick_upper_index: self.tick_upper_index,
                ..Default::default()
            }
        }
    }
}
