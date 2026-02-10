use super::super::{BytesI32, BytesU128, BytesU64, Pubkey};
use super::MemoryMappedWhirlpool;
use crate::pinocchio::state::whirlpool::NUM_REWARDS;
use crate::{
    errors::ErrorCode,
    math::FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD,
    pinocchio::{state::WhirlpoolProgramAccount, Result},
    state::Tick,
};

#[repr(C)]
pub struct MemoryMappedPositionRewardInfo {
    growth_inside_checkpoint: BytesU128,
    amount_owed: BytesU64,
}

impl MemoryMappedPositionRewardInfo {
    #[inline(always)]
    pub fn growth_inside_checkpoint(&self) -> u128 {
        u128::from_le_bytes(self.growth_inside_checkpoint)
    }

    #[inline(always)]
    pub fn amount_owed(&self) -> u64 {
        u64::from_le_bytes(self.amount_owed)
    }
}

#[repr(C)]
pub struct MemoryMappedPosition {
    discriminator: [u8; 8],

    whirlpool: Pubkey,
    position_mint: Pubkey,
    liquidity: BytesU128,
    tick_lower_index: BytesI32,
    tick_upper_index: BytesI32,
    fee_growth_checkpoint_a: BytesU128,
    fee_owed_a: BytesU64,
    fee_growth_checkpoint_b: BytesU128,
    fee_owed_b: BytesU64,
    reward_infos: [MemoryMappedPositionRewardInfo; crate::state::NUM_REWARDS],
}

impl WhirlpoolProgramAccount for MemoryMappedPosition {
    const DISCRIMINATOR: [u8; 8] = [0xaa, 0xbc, 0x8f, 0xe4, 0x7a, 0x40, 0xf7, 0xd0];
}

impl MemoryMappedPosition {
    #[inline(always)]
    pub fn whirlpool(&self) -> &Pubkey {
        &self.whirlpool
    }

    #[inline(always)]
    pub fn position_mint(&self) -> &Pubkey {
        &self.position_mint
    }

    #[inline(always)]
    pub fn liquidity(&self) -> u128 {
        u128::from_le_bytes(self.liquidity)
    }

    #[inline(always)]
    pub fn tick_lower_index(&self) -> i32 {
        i32::from_le_bytes(self.tick_lower_index)
    }

    #[inline(always)]
    pub fn tick_upper_index(&self) -> i32 {
        i32::from_le_bytes(self.tick_upper_index)
    }

    #[inline(always)]
    pub fn fee_growth_checkpoint_a(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_checkpoint_a)
    }

    #[inline(always)]
    pub fn fee_owed_a(&self) -> u64 {
        u64::from_le_bytes(self.fee_owed_a)
    }

    #[inline(always)]
    pub fn fee_growth_checkpoint_b(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_checkpoint_b)
    }

    #[inline(always)]
    pub fn fee_owed_b(&self) -> u64 {
        u64::from_le_bytes(self.fee_owed_b)
    }

    #[inline(always)]
    pub fn reward_infos(&self) -> &[MemoryMappedPositionRewardInfo; crate::state::NUM_REWARDS] {
        &self.reward_infos
    }

    pub fn reset_position_range(
        &mut self,
        whirlpool: &MemoryMappedWhirlpool,
        new_tick_lower_index: i32,
        new_tick_upper_index: i32,
        keep_owed: bool,
    ) -> Result<()> {
        if !self.is_position_empty(keep_owed) {
            return Err(ErrorCode::ClosePositionNotEmpty.into());
        }

        if new_tick_lower_index == self.tick_lower_index()
            && new_tick_upper_index == self.tick_upper_index()
        {
            return Err(ErrorCode::SameTickRangeNotAllowed.into());
        }

        validate_tick_range_for_whirlpool(whirlpool, new_tick_lower_index, new_tick_upper_index)?;

        self.set_tick_lower_index(new_tick_lower_index);
        self.set_tick_upper_index(new_tick_upper_index);
        self.set_fee_growth_checkpoint_a(0);
        self.set_fee_growth_checkpoint_b(0);
        self.reset_reward_growth_checkpoints();

        Ok(())
    }

    pub fn update(&mut self, update: &crate::state::PositionUpdate) {
        self.set_liquidity(update.liquidity);
        self.set_fee_growth_checkpoint_a(update.fee_growth_checkpoint_a);
        self.set_fee_growth_checkpoint_b(update.fee_growth_checkpoint_b);
        self.set_fee_owed_a(update.fee_owed_a);
        self.set_fee_owed_b(update.fee_owed_b);
        self.set_reward_infos(&update.reward_infos);
    }

    fn is_position_empty(&self, keep_owed: bool) -> bool {
        if keep_owed {
            return self.liquidity() == 0;
        }

        let fees_not_owed = self.fee_owed_a() == 0 && self.fee_owed_b() == 0;
        let mut rewards_not_owed = true;
        for i in 0..NUM_REWARDS {
            rewards_not_owed = rewards_not_owed && self.reward_infos()[i].amount_owed() == 0
        }
        self.liquidity() == 0 && fees_not_owed && rewards_not_owed
    }

    fn set_liquidity(&mut self, liquidity: u128) {
        self.liquidity = liquidity.to_le_bytes();
    }

    fn set_tick_lower_index(&mut self, tick_lower_index: i32) {
        self.tick_lower_index = tick_lower_index.to_le_bytes();
    }

    fn set_tick_upper_index(&mut self, tick_upper_index: i32) {
        self.tick_upper_index = tick_upper_index.to_le_bytes();
    }

    fn set_fee_growth_checkpoint_a(&mut self, fee_growth_checkpoint_a: u128) {
        self.fee_growth_checkpoint_a = fee_growth_checkpoint_a.to_le_bytes();
    }

    fn set_fee_growth_checkpoint_b(&mut self, fee_growth_checkpoint_b: u128) {
        self.fee_growth_checkpoint_b = fee_growth_checkpoint_b.to_le_bytes();
    }

    fn set_fee_owed_a(&mut self, fee_owed_a: u64) {
        self.fee_owed_a = fee_owed_a.to_le_bytes();
    }

    fn set_fee_owed_b(&mut self, fee_owed_b: u64) {
        self.fee_owed_b = fee_owed_b.to_le_bytes();
    }

    fn set_reward_infos(
        &mut self,
        reward_infos: &[crate::state::PositionRewardInfo; crate::state::NUM_REWARDS],
    ) {
        self.reward_infos[0].amount_owed = reward_infos[0].amount_owed.to_le_bytes();
        self.reward_infos[0].growth_inside_checkpoint =
            reward_infos[0].growth_inside_checkpoint.to_le_bytes();
        self.reward_infos[1].amount_owed = reward_infos[1].amount_owed.to_le_bytes();
        self.reward_infos[1].growth_inside_checkpoint =
            reward_infos[1].growth_inside_checkpoint.to_le_bytes();
        self.reward_infos[2].amount_owed = reward_infos[2].amount_owed.to_le_bytes();
        self.reward_infos[2].growth_inside_checkpoint =
            reward_infos[2].growth_inside_checkpoint.to_le_bytes();
    }

    fn reset_reward_growth_checkpoints(&mut self) {
        for reward_info in &mut self.reward_infos {
            reward_info.growth_inside_checkpoint = 0u128.to_le_bytes();
        }
    }
}

fn validate_tick_range_for_whirlpool(
    whirlpool: &MemoryMappedWhirlpool,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    let tick_spacing = whirlpool.tick_spacing();

    if !Tick::check_is_usable_tick(tick_lower_index, tick_spacing)
        || !Tick::check_is_usable_tick(tick_upper_index, tick_spacing)
        || tick_lower_index >= tick_upper_index
    {
        return Err(ErrorCode::InvalidTickIndex.into());
    }

    if tick_spacing >= FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD {
        let (full_range_lower_index, full_range_upper_index) =
            Tick::full_range_indexes(tick_spacing);
        if tick_lower_index != full_range_lower_index || tick_upper_index != full_range_upper_index
        {
            return Err(ErrorCode::FullRangeOnlyPool.into());
        }
    }

    Ok(())
}
