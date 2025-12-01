use super::super::{BytesI32, BytesU128, BytesU16, BytesU64, Pubkey};
use crate::pinocchio::state::WhirlpoolProgramAccount;
use pinocchio::instruction::Seed;

#[repr(C)]
pub struct MemoryMappedWhirlpoolRewardInfo {
    mint: Pubkey,
    vault: Pubkey,
    extension: [u8; 32],
    emissions_per_second_x64: BytesU128,
    growth_global_x64: BytesU128,
}

impl MemoryMappedWhirlpoolRewardInfo {
    #[inline(always)]
    pub fn mint(&self) -> &Pubkey {
        &self.mint
    }

    #[inline(always)]
    pub fn vault(&self) -> &Pubkey {
        &self.vault
    }

    #[inline(always)]
    pub fn extension(&self) -> &[u8; 32] {
        &self.extension
    }

    #[inline(always)]
    pub fn emissions_per_second_x64(&self) -> u128 {
        u128::from_le_bytes(self.emissions_per_second_x64)
    }

    #[inline(always)]
    pub fn growth_global_x64(&self) -> u128 {
        u128::from_le_bytes(self.growth_global_x64)
    }

    #[inline(always)]
    pub fn initialized(&self) -> bool {
        self.mint != Pubkey::default()
    }
}

#[repr(C)]
pub struct MemoryMappedWhirlpool {
    discriminator: [u8; 8],

    whirlpools_config: Pubkey,
    whirlpool_bump: [u8; 1],
    tick_spacing: BytesU16,
    fee_tier_index_seed: [u8; 2],
    fee_rate: BytesU16,
    protocol_fee_rate: BytesU16,
    liquidity: BytesU128,
    sqrt_price: BytesU128,
    tick_current_index: BytesI32,
    protocol_fee_owed_a: BytesU64,
    protocol_fee_owed_b: BytesU64,
    token_mint_a: Pubkey,
    token_vault_a: Pubkey,
    fee_growth_global_a: BytesU128,
    token_mint_b: Pubkey,
    token_vault_b: Pubkey,
    fee_growth_global_b: BytesU128,
    reward_last_updated_timestamp: BytesU64,
    reward_infos: [MemoryMappedWhirlpoolRewardInfo; crate::state::NUM_REWARDS],
}

impl WhirlpoolProgramAccount for MemoryMappedWhirlpool {
    const DISCRIMINATOR: [u8; 8] = [0x3f, 0x95, 0xd1, 0x0c, 0xe1, 0x80, 0x63, 0x09];
}

impl MemoryMappedWhirlpool {
    #[inline(always)]
    pub fn seeds(&self) -> [Seed<'_>; 6] {
        [
            Seed::from(b"whirlpool"),
            Seed::from(&self.whirlpools_config),
            Seed::from(&self.token_mint_a),
            Seed::from(&self.token_mint_b),
            Seed::from(&self.fee_tier_index_seed),
            Seed::from(&self.whirlpool_bump),
        ]
    }

    #[inline(always)]
    pub fn tick_spacing(&self) -> u16 {
        u16::from_le_bytes(self.tick_spacing)
    }

    #[inline(always)]
    pub fn fee_rate(&self) -> u16 {
        u16::from_le_bytes(self.fee_rate)
    }

    #[inline(always)]
    pub fn protocol_fee_rate(&self) -> u16 {
        u16::from_le_bytes(self.protocol_fee_rate)
    }

    #[inline(always)]
    pub fn liquidity(&self) -> u128 {
        u128::from_le_bytes(self.liquidity)
    }

    #[inline(always)]
    pub fn sqrt_price(&self) -> u128 {
        u128::from_le_bytes(self.sqrt_price)
    }

    #[inline(always)]
    pub fn tick_current_index(&self) -> i32 {
        i32::from_le_bytes(self.tick_current_index)
    }

    #[inline(always)]
    pub fn token_mint_a(&self) -> &Pubkey {
        &self.token_mint_a
    }

    #[inline(always)]
    pub fn token_mint_b(&self) -> &Pubkey {
        &self.token_mint_b
    }

    #[inline(always)]
    pub fn token_vault_a(&self) -> &Pubkey {
        &self.token_vault_a
    }

    #[inline(always)]
    pub fn token_vault_b(&self) -> &Pubkey {
        &self.token_vault_b
    }

    #[inline(always)]
    pub fn fee_growth_global_a(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_global_a)
    }

    #[inline(always)]
    pub fn fee_growth_global_b(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_global_b)
    }

    #[inline(always)]
    pub fn protocol_fee_owed_a(&self) -> u64 {
        u64::from_le_bytes(self.protocol_fee_owed_a)
    }

    #[inline(always)]
    pub fn protocol_fee_owed_b(&self) -> u64 {
        u64::from_le_bytes(self.protocol_fee_owed_b)
    }

    #[inline(always)]
    pub fn reward_last_updated_timestamp(&self) -> u64 {
        u64::from_le_bytes(self.reward_last_updated_timestamp)
    }

    #[inline(always)]
    pub fn reward_infos(&self) -> &[MemoryMappedWhirlpoolRewardInfo; crate::state::NUM_REWARDS] {
        &self.reward_infos
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_after_swap(
        &mut self,
        liquidity: &u128,
        tick_index: i32,
        sqrt_price: &u128,
        fee_growth_global: &u128,
        reward_growths_global: &[u128; crate::state::NUM_REWARDS],
        protocol_fee: u64,
        is_token_fee_in_a: bool,
        reward_last_updated_timestamp: u64,
    ) {
        self.set_tick_current_index(tick_index);
        self.set_sqrt_price(sqrt_price);
        self.set_liquidity(liquidity);
        self.set_reward_growths_global(reward_growths_global);
        self.set_reward_last_updated_timestamp(reward_last_updated_timestamp);

        if is_token_fee_in_a {
            // Add fees taken via a
            self.set_fee_growth_global_a(fee_growth_global);
            self.set_protocol_fee_owed_a(self.protocol_fee_owed_a() + protocol_fee);
        } else {
            // Add fees taken via b
            self.set_fee_growth_global_b(fee_growth_global);
            self.set_protocol_fee_owed_b(self.protocol_fee_owed_b() + protocol_fee);
        }
    }

    pub fn update_liquidity_and_reward_growth_global(
        &mut self,
        liquidity: &u128,
        reward_growths_global: &[u128; crate::state::NUM_REWARDS],
        reward_last_updated_timestamp: u64,
    ) {
        self.set_liquidity(liquidity);
        self.set_reward_growths_global(reward_growths_global);
        self.set_reward_last_updated_timestamp(reward_last_updated_timestamp);
    }

    fn set_tick_current_index(&mut self, tick_index: i32) {
        self.tick_current_index = tick_index.to_le_bytes();
    }

    fn set_sqrt_price(&mut self, sqrt_price: &u128) {
        self.sqrt_price = sqrt_price.to_le_bytes();
    }

    fn set_fee_growth_global_a(&mut self, fee_growth_global_a: &u128) {
        self.fee_growth_global_a = fee_growth_global_a.to_le_bytes();
    }

    fn set_fee_growth_global_b(&mut self, fee_growth_global_b: &u128) {
        self.fee_growth_global_b = fee_growth_global_b.to_le_bytes();
    }

    fn set_protocol_fee_owed_a(&mut self, protocol_fee_owed_a: u64) {
        self.protocol_fee_owed_a = protocol_fee_owed_a.to_le_bytes();
    }

    fn set_protocol_fee_owed_b(&mut self, protocol_fee_owed_b: u64) {
        self.protocol_fee_owed_b = protocol_fee_owed_b.to_le_bytes();
    }

    fn set_liquidity(&mut self, liquidity: &u128) {
        self.liquidity = liquidity.to_le_bytes();
    }

    fn set_reward_growths_global(
        &mut self,
        reward_growth_global: &[u128; crate::state::NUM_REWARDS],
    ) {
        self.reward_infos[0].growth_global_x64 = reward_growth_global[0].to_le_bytes();
        self.reward_infos[1].growth_global_x64 = reward_growth_global[1].to_le_bytes();
        self.reward_infos[2].growth_global_x64 = reward_growth_global[2].to_le_bytes();
    }

    fn set_reward_last_updated_timestamp(&mut self, last_updated_timestamp: u64) {
        self.reward_last_updated_timestamp = last_updated_timestamp.to_le_bytes();
    }
}
