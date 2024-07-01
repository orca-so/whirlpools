use crate::{
    errors::ErrorCode,
    math::{
        tick_index_from_sqrt_price, MAX_FEE_RATE, MAX_PROTOCOL_FEE_RATE, MAX_SQRT_PRICE_X64,
        MIN_SQRT_PRICE_X64,
    },
};
use anchor_lang::prelude::*;

use super::WhirlpoolsConfig;

#[derive(Default)]
#[repr(C)]
#[repr(align(16))]
#[account(zero_copy)]
pub struct Whirlpool {
    pub reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS], // 384 bytes
    pub whirlpools_config: Pubkey,          // 32 bytes
    pub token_mint_a: Pubkey,               // 32 bytes
    pub token_vault_a: Pubkey,              // 32 bytes
    pub token_mint_b: Pubkey,               // 32 bytes
    pub token_vault_b: Pubkey,              // 32 bytes
    pub liquidity: u128,                    // 16 bytes
    pub sqrt_price: u128,                   // 16 bytes
    pub fee_growth_global_a: u128,          // 16 bytes
    pub fee_growth_global_b: u128,          // 16 bytes
    pub protocol_fee_owed_a: u64,           // 8 bytes
    pub protocol_fee_owed_b: u64,           // 8 bytes
    pub reward_last_updated_timestamp: u64, // 8 bytes
    pub tick_current_index: i32,            // 4 bytes
    pub tick_spacing: u16,                  // 2 bytes
    pub tick_spacing_seed: [u8; 2],         // 2 bytes
    pub fee_rate: u16,                      // 2 bytes
    pub protocol_fee_rate: u16,             // 2 bytes
    pub whirlpool_bump: [u8; 1],            // 1 byte
    _padding0: [u8; 11],                    // 11 bytes padding to align to 16 bytes
}

// Number of rewards supported by Whirlpools
pub const NUM_REWARDS: usize = 3;

impl Whirlpool {
    pub const LEN: usize = 8 + 261 + 384;
    pub fn seeds(&self) -> [&[u8]; 6] {
        [
            &b"whirlpool"[..],
            self.whirlpools_config.as_ref(),
            self.token_mint_a.as_ref(),
            self.token_mint_b.as_ref(),
            self.tick_spacing_seed.as_ref(),
            self.whirlpool_bump.as_ref(),
        ]
    }

    pub fn input_token_mint(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_mint_a
        } else {
            self.token_mint_b
        }
    }

    pub fn input_token_vault(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_vault_a
        } else {
            self.token_vault_b
        }
    }

    pub fn output_token_mint(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_mint_b
        } else {
            self.token_mint_a
        }
    }

    pub fn output_token_vault(&self, a_to_b: bool) -> Pubkey {
        if a_to_b {
            self.token_vault_b
        } else {
            self.token_vault_a
        }
    }

    pub fn initialize(
        &mut self,
        whirlpools_config: &Account<WhirlpoolsConfig>,
        bump: u8,
        tick_spacing: u16,
        sqrt_price: u128,
        default_fee_rate: u16,
        token_mint_a: Pubkey,
        token_vault_a: Pubkey,
        token_mint_b: Pubkey,
        token_vault_b: Pubkey,
    ) -> Result<()> {
        if token_mint_a.ge(&token_mint_b) {
            return Err(ErrorCode::InvalidTokenMintOrder.into());
        }

        if sqrt_price < MIN_SQRT_PRICE_X64 || sqrt_price > MAX_SQRT_PRICE_X64 {
            return Err(ErrorCode::SqrtPriceOutOfBounds.into());
        }

        self.whirlpools_config = whirlpools_config.key();
        self.whirlpool_bump = [bump];

        self.tick_spacing = tick_spacing;
        self.tick_spacing_seed = self.tick_spacing.to_le_bytes();

        self.update_fee_rate(default_fee_rate)?;
        self.update_protocol_fee_rate(whirlpools_config.default_protocol_fee_rate)?;

        self.liquidity = 0;
        self.sqrt_price = sqrt_price;
        self.tick_current_index = tick_index_from_sqrt_price(&sqrt_price);

        self.protocol_fee_owed_a = 0;
        self.protocol_fee_owed_b = 0;

        self.token_mint_a = token_mint_a;
        self.token_vault_a = token_vault_a;
        self.fee_growth_global_a = 0;

        self.token_mint_b = token_mint_b;
        self.token_vault_b = token_vault_b;
        self.fee_growth_global_b = 0;

        self.reward_infos =
            [WhirlpoolRewardInfo::new(whirlpools_config.reward_emissions_super_authority);
                NUM_REWARDS];

        Ok(())
    }

    /// Update all reward values for the Whirlpool.
    ///
    /// # Parameters
    /// - `reward_infos` - An array of all updated whirlpool rewards
    /// - `reward_last_updated_timestamp` - The timestamp when the rewards were last updated
    pub fn update_rewards(
        &mut self,
        reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
        reward_last_updated_timestamp: u64,
    ) {
        self.reward_last_updated_timestamp = reward_last_updated_timestamp;
        self.reward_infos = reward_infos;
    }

    pub fn update_rewards_and_liquidity(
        &mut self,
        reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
        liquidity: u128,
        reward_last_updated_timestamp: u64,
    ) {
        self.update_rewards(reward_infos, reward_last_updated_timestamp);
        self.liquidity = liquidity;
    }

    /// Update the reward authority at the specified Whirlpool reward index.
    pub fn update_reward_authority(&mut self, index: usize, authority: Pubkey) -> Result<()> {
        if index >= NUM_REWARDS {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }
        self.reward_infos[index].authority = authority;

        Ok(())
    }

    pub fn update_emissions(
        &mut self,
        index: usize,
        reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
        timestamp: u64,
        emissions_per_second_x64: u128,
    ) -> Result<()> {
        if index >= NUM_REWARDS {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }
        self.update_rewards(reward_infos, timestamp);
        self.reward_infos[index].emissions_per_second_x64 = emissions_per_second_x64;

        Ok(())
    }

    pub fn initialize_reward(&mut self, index: usize, mint: Pubkey, vault: Pubkey) -> Result<()> {
        if index >= NUM_REWARDS {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }

        let lowest_index = match self.reward_infos.iter().position(|r| !r.initialized()) {
            Some(lowest_index) => lowest_index,
            None => return Err(ErrorCode::InvalidRewardIndex.into()),
        };

        if lowest_index != index {
            return Err(ErrorCode::InvalidRewardIndex.into());
        }

        self.reward_infos[index].mint = mint;
        self.reward_infos[index].vault = vault;

        Ok(())
    }

    pub fn update_after_swap(
        &mut self,
        liquidity: u128,
        tick_index: i32,
        sqrt_price: u128,
        fee_growth_global: u128,
        reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
        protocol_fee: u64,
        is_token_fee_in_a: bool,
        reward_last_updated_timestamp: u64,
    ) {
        self.tick_current_index = tick_index;
        self.sqrt_price = sqrt_price;
        self.liquidity = liquidity;
        self.reward_infos = reward_infos;
        self.reward_last_updated_timestamp = reward_last_updated_timestamp;
        if is_token_fee_in_a {
            // Add fees taken via a
            self.fee_growth_global_a = fee_growth_global;
            self.protocol_fee_owed_a += protocol_fee;
        } else {
            // Add fees taken via b
            self.fee_growth_global_b = fee_growth_global;
            self.protocol_fee_owed_b += protocol_fee;
        }
    }

    pub fn update_fee_rate(&mut self, fee_rate: u16) -> Result<()> {
        if fee_rate > MAX_FEE_RATE {
            return Err(ErrorCode::FeeRateMaxExceeded.into());
        }
        self.fee_rate = fee_rate;

        Ok(())
    }

    pub fn update_protocol_fee_rate(&mut self, protocol_fee_rate: u16) -> Result<()> {
        if protocol_fee_rate > MAX_PROTOCOL_FEE_RATE {
            return Err(ErrorCode::ProtocolFeeRateMaxExceeded.into());
        }
        self.protocol_fee_rate = protocol_fee_rate;

        Ok(())
    }

    pub fn reset_protocol_fees_owed(&mut self) {
        self.protocol_fee_owed_a = 0;
        self.protocol_fee_owed_b = 0;
    }
}

/// Stores the state relevant for tracking liquidity mining rewards at the `Whirlpool` level.
/// These values are used in conjunction with `PositionRewardInfo`, `Tick.reward_growths_outside`,
/// and `Whirlpool.reward_last_updated_timestamp` to determine how many rewards are earned by open
/// positions.
#[derive(Default, Debug, PartialEq)]
#[repr(C)]
#[account(zero_copy)]
pub struct WhirlpoolRewardInfo {
    /// Reward token mint.
    pub mint: Pubkey,
    /// Reward vault token account.
    pub vault: Pubkey,
    /// Authority account that has permission to initialize the reward and set emissions.
    pub authority: Pubkey,
    /// Q64.64 number that indicates how many tokens per second are earned per unit of liquidity.
    pub emissions_per_second_x64: u128,
    /// Q64.64 number that tracks the total tokens earned per unit of liquidity since the reward
    /// emissions were turned on.
    pub growth_global_x64: u128,
}

impl WhirlpoolRewardInfo {
    /// Creates a new `WhirlpoolRewardInfo` with the authority set
    pub fn new(authority: Pubkey) -> Self {
        Self {
            authority,
            ..Default::default()
        }
    }

    /// Returns true if this reward is initialized.
    /// Once initialized, a reward cannot transition back to uninitialized.
    pub fn initialized(&self) -> bool {
        self.mint.ne(&Pubkey::default())
    }

    /// Maps all reward data to only the reward growth accumulators
    pub fn to_reward_growths(
        reward_infos: &[WhirlpoolRewardInfo; NUM_REWARDS],
    ) -> [u128; NUM_REWARDS] {
        let mut reward_growths = [0u128; NUM_REWARDS];
        for i in 0..NUM_REWARDS {
            reward_growths[i] = reward_infos[i].growth_global_x64;
        }
        reward_growths
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy)]
pub struct WhirlpoolBumps {
    pub whirlpool_bump: u8,
}

#[test]
fn test_whirlpool_reward_info_not_initialized() {
    let reward_info = WhirlpoolRewardInfo::default();
    assert_eq!(reward_info.initialized(), false);
}

#[test]
fn test_whirlpool_reward_info_initialized() {
    let reward_info = &mut WhirlpoolRewardInfo::default();
    reward_info.mint = Pubkey::new_unique();
    assert_eq!(reward_info.initialized(), true);
}

#[cfg(test)]
pub mod whirlpool_builder {
    use super::{Whirlpool, WhirlpoolRewardInfo, NUM_REWARDS};

    #[derive(Default)]
    pub struct WhirlpoolBuilder {
        liquidity: u128,
        tick_spacing: u16,
        tick_current_index: i32,
        sqrt_price: u128,
        fee_rate: u16,
        protocol_fee_rate: u16,
        fee_growth_global_a: u128,
        fee_growth_global_b: u128,
        reward_last_updated_timestamp: u64,
        reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
    }

    impl WhirlpoolBuilder {
        pub fn new() -> Self {
            Self {
                reward_infos: [WhirlpoolRewardInfo::default(); NUM_REWARDS],
                ..Default::default()
            }
        }

        pub fn liquidity(mut self, liquidity: u128) -> Self {
            self.liquidity = liquidity;
            self
        }

        pub fn reward_last_updated_timestamp(mut self, reward_last_updated_timestamp: u64) -> Self {
            self.reward_last_updated_timestamp = reward_last_updated_timestamp;
            self
        }

        pub fn reward_info(mut self, index: usize, reward_info: WhirlpoolRewardInfo) -> Self {
            self.reward_infos[index] = reward_info;
            self
        }

        pub fn reward_infos(mut self, reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS]) -> Self {
            self.reward_infos = reward_infos;
            self
        }

        pub fn tick_spacing(mut self, tick_spacing: u16) -> Self {
            self.tick_spacing = tick_spacing;
            self
        }

        pub fn tick_current_index(mut self, tick_current_index: i32) -> Self {
            self.tick_current_index = tick_current_index;
            self
        }

        pub fn sqrt_price(mut self, sqrt_price: u128) -> Self {
            self.sqrt_price = sqrt_price;
            self
        }

        pub fn fee_growth_global_a(mut self, fee_growth_global_a: u128) -> Self {
            self.fee_growth_global_a = fee_growth_global_a;
            self
        }

        pub fn fee_growth_global_b(mut self, fee_growth_global_b: u128) -> Self {
            self.fee_growth_global_b = fee_growth_global_b;
            self
        }

        pub fn fee_rate(mut self, fee_rate: u16) -> Self {
            self.fee_rate = fee_rate;
            self
        }

        pub fn protocol_fee_rate(mut self, protocol_fee_rate: u16) -> Self {
            self.protocol_fee_rate = protocol_fee_rate;
            self
        }

        pub fn build(self) -> Whirlpool {
            Whirlpool {
                liquidity: self.liquidity,
                reward_last_updated_timestamp: self.reward_last_updated_timestamp,
                reward_infos: self.reward_infos,
                tick_current_index: self.tick_current_index,
                sqrt_price: self.sqrt_price,
                tick_spacing: self.tick_spacing,
                fee_growth_global_a: self.fee_growth_global_a,
                fee_growth_global_b: self.fee_growth_global_b,
                fee_rate: self.fee_rate,
                protocol_fee_rate: self.protocol_fee_rate,
                ..Default::default()
            }
        }
    }
}
