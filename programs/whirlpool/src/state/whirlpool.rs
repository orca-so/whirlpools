use crate::{
    errors::ErrorCode,
    math::{
        tick_index_from_sqrt_price, MAX_FEE_RATE, MAX_PROTOCOL_FEE_RATE, MAX_SQRT_PRICE_X64,
        MIN_SQRT_PRICE_X64,
    },
};
use anchor_lang::prelude::*;

use super::WhirlpoolsConfig;

#[account]
#[derive(Default)]
pub struct Whirlpool {
    pub whirlpools_config: Pubkey, // 32
    pub whirlpool_bump: [u8; 1],   // 1

    pub tick_spacing: u16,            // 2
    pub fee_tier_index_seed: [u8; 2], // 2

    // Stored as hundredths of a basis point
    // u16::MAX corresponds to ~6.5%
    pub fee_rate: u16, // 2

    // Portion of fee rate taken stored as basis points
    pub protocol_fee_rate: u16, // 2

    // Maximum amount that can be held by Solana account
    pub liquidity: u128, // 16

    // MAX/MIN at Q32.64, but using Q64.64 for rounder bytes
    // Q64.64
    pub sqrt_price: u128,        // 16
    pub tick_current_index: i32, // 4

    pub protocol_fee_owed_a: u64, // 8
    pub protocol_fee_owed_b: u64, // 8

    pub token_mint_a: Pubkey,  // 32
    pub token_vault_a: Pubkey, // 32

    // Q64.64
    pub fee_growth_global_a: u128, // 16

    pub token_mint_b: Pubkey,  // 32
    pub token_vault_b: Pubkey, // 32

    // Q64.64
    pub fee_growth_global_b: u128, // 16

    pub reward_last_updated_timestamp: u64, // 8

    pub reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS], // 384
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
            self.fee_tier_index_seed.as_ref(),
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

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        whirlpools_config: &Account<WhirlpoolsConfig>,
        fee_tier_index: u16,
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

        if !(MIN_SQRT_PRICE_X64..=MAX_SQRT_PRICE_X64).contains(&sqrt_price) {
            return Err(ErrorCode::SqrtPriceOutOfBounds.into());
        }

        if tick_spacing == 0 {
            // FeeTier and AdaptiveFeeTier enforce tick_spacing > 0
            unreachable!("tick_spacing must be greater than 0");
        }

        self.whirlpools_config = whirlpools_config.key();
        self.fee_tier_index_seed = fee_tier_index.to_le_bytes();
        self.whirlpool_bump = [bump];

        self.tick_spacing = tick_spacing;

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

    #[allow(clippy::too_many_arguments)]
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

    pub fn fee_tier_index(&self) -> u16 {
        u16::from_le_bytes(self.fee_tier_index_seed)
    }

    pub fn is_initialized_with_adaptive_fee_tier(&self) -> bool {
        self.fee_tier_index() != self.tick_spacing
    }
}

/// Stores the state relevant for tracking liquidity mining rewards at the `Whirlpool` level.
/// These values are used in conjunction with `PositionRewardInfo`, `Tick.reward_growths_outside`,
/// and `Whirlpool.reward_last_updated_timestamp` to determine how many rewards are earned by open
/// positions.
#[derive(Copy, Clone, AnchorSerialize, AnchorDeserialize, Default, Debug, PartialEq)]
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
    assert!(!reward_info.initialized());
}

#[test]
fn test_whirlpool_reward_info_initialized() {
    let reward_info = &mut WhirlpoolRewardInfo::default();
    reward_info.mint = Pubkey::new_unique();
    assert!(reward_info.initialized());
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

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_whirlpool_data_layout() {
        let whirlpool_whirlpools_config = Pubkey::new_unique();
        let whirlpool_bump = 0x12u8;
        let whirlpool_tick_spacing = 0x1234u16;
        let whirlpool_tick_spacing_seed = [0x56u8, 0x78u8];
        let whirlpool_fee_rate = 0x9abcu16;
        let whirlpool_protocol_fee_rate = 0xdef0u16;
        let whirlpool_liquidity = 0x11002233445566778899aabbccddeeffu128;
        let whirlpool_sqrt_price = 0x11220033445566778899aabbccddeeffu128;
        let whirlpool_tick_current_index = 0x12345678i32;
        let whirlpool_protocol_fee_owed_a = 0x1122334455667788u64;
        let whirlpool_protocol_fee_owed_b = 0x99aabbccddeeff00u64;
        let whirlpool_token_mint_a = Pubkey::new_unique();
        let whirlpool_token_vault_a = Pubkey::new_unique();
        let whirlpool_fee_growth_global_a = 0x11223300445566778899aabbccddeeffu128;
        let whirlpool_token_mint_b = Pubkey::new_unique();
        let whirlpool_token_vault_b = Pubkey::new_unique();
        let whirlpool_fee_growth_global_b = 0x11223344005566778899aabbccddeeffu128;
        let whirlpool_reward_last_updated_timestamp = 0x1234567890abcdefu64;

        let reward_info_mint = Pubkey::new_unique();
        let reward_info_vault = Pubkey::new_unique();
        let reward_info_authority = Pubkey::new_unique();
        let reward_info_emissions_per_second_x64 = 0x1122334455667788u128;
        let reward_info_growth_global_x64 = 0x99aabbccddeeff00u128;

        // manually build the expected data layout
        let mut reward_info_data = [0u8; 128];
        let mut offset = 0;
        reward_info_data[offset..offset + 32].copy_from_slice(&reward_info_mint.to_bytes());
        offset += 32;
        reward_info_data[offset..offset + 32].copy_from_slice(&reward_info_vault.to_bytes());
        offset += 32;
        reward_info_data[offset..offset + 32].copy_from_slice(&reward_info_authority.to_bytes());
        offset += 32;
        reward_info_data[offset..offset + 16]
            .copy_from_slice(&reward_info_emissions_per_second_x64.to_le_bytes());
        offset += 16;
        reward_info_data[offset..offset + 16]
            .copy_from_slice(&reward_info_growth_global_x64.to_le_bytes());
        offset += 16;
        assert_eq!(offset, reward_info_data.len());

        let mut whirlpool_data = [0u8; Whirlpool::LEN];
        let mut offset = 0;
        whirlpool_data[offset..offset + 8].copy_from_slice(&Whirlpool::discriminator());
        offset += 8;
        whirlpool_data[offset..offset + 32]
            .copy_from_slice(&whirlpool_whirlpools_config.to_bytes());
        offset += 32;
        whirlpool_data[offset..offset + 1].copy_from_slice(&whirlpool_bump.to_le_bytes());
        offset += 1;
        whirlpool_data[offset..offset + 2].copy_from_slice(&whirlpool_tick_spacing.to_le_bytes());
        offset += 2;
        whirlpool_data[offset..offset + 2].copy_from_slice(&whirlpool_tick_spacing_seed);
        offset += 2;
        whirlpool_data[offset..offset + 2].copy_from_slice(&whirlpool_fee_rate.to_le_bytes());
        offset += 2;
        whirlpool_data[offset..offset + 2]
            .copy_from_slice(&whirlpool_protocol_fee_rate.to_le_bytes());
        offset += 2;
        whirlpool_data[offset..offset + 16].copy_from_slice(&whirlpool_liquidity.to_le_bytes());
        offset += 16;
        whirlpool_data[offset..offset + 16].copy_from_slice(&whirlpool_sqrt_price.to_le_bytes());
        offset += 16;
        whirlpool_data[offset..offset + 4]
            .copy_from_slice(&whirlpool_tick_current_index.to_le_bytes());
        offset += 4;
        whirlpool_data[offset..offset + 8]
            .copy_from_slice(&whirlpool_protocol_fee_owed_a.to_le_bytes());
        offset += 8;
        whirlpool_data[offset..offset + 8]
            .copy_from_slice(&whirlpool_protocol_fee_owed_b.to_le_bytes());
        offset += 8;
        whirlpool_data[offset..offset + 32].copy_from_slice(&whirlpool_token_mint_a.to_bytes());
        offset += 32;
        whirlpool_data[offset..offset + 32].copy_from_slice(&whirlpool_token_vault_a.to_bytes());
        offset += 32;
        whirlpool_data[offset..offset + 16]
            .copy_from_slice(&whirlpool_fee_growth_global_a.to_le_bytes());
        offset += 16;
        whirlpool_data[offset..offset + 32].copy_from_slice(&whirlpool_token_mint_b.to_bytes());
        offset += 32;
        whirlpool_data[offset..offset + 32].copy_from_slice(&whirlpool_token_vault_b.to_bytes());
        offset += 32;
        whirlpool_data[offset..offset + 16]
            .copy_from_slice(&whirlpool_fee_growth_global_b.to_le_bytes());
        offset += 16;
        whirlpool_data[offset..offset + 8]
            .copy_from_slice(&whirlpool_reward_last_updated_timestamp.to_le_bytes());
        offset += 8;
        for _ in 0..NUM_REWARDS {
            whirlpool_data[offset..offset + reward_info_data.len()]
                .copy_from_slice(&reward_info_data);
            offset += reward_info_data.len();
        }
        assert_eq!(offset, whirlpool_data.len());

        // deserialize
        let deserialized = Whirlpool::try_deserialize(&mut whirlpool_data.as_ref()).unwrap();

        assert_eq!(deserialized.whirlpools_config, whirlpool_whirlpools_config);
        assert_eq!(deserialized.whirlpool_bump, [whirlpool_bump]);
        assert_eq!(deserialized.tick_spacing, whirlpool_tick_spacing);
        assert_eq!(
            deserialized.fee_tier_index_seed,
            whirlpool_tick_spacing_seed
        );
        assert_eq!(deserialized.fee_rate, whirlpool_fee_rate);
        assert_eq!(deserialized.protocol_fee_rate, whirlpool_protocol_fee_rate);
        assert_eq!(deserialized.liquidity, whirlpool_liquidity);
        assert_eq!(deserialized.sqrt_price, whirlpool_sqrt_price);
        assert_eq!(
            deserialized.tick_current_index,
            whirlpool_tick_current_index
        );
        assert_eq!(
            deserialized.protocol_fee_owed_a,
            whirlpool_protocol_fee_owed_a
        );
        assert_eq!(
            deserialized.protocol_fee_owed_b,
            whirlpool_protocol_fee_owed_b
        );
        assert_eq!(deserialized.token_mint_a, whirlpool_token_mint_a);
        assert_eq!(deserialized.token_vault_a, whirlpool_token_vault_a);
        assert_eq!(
            deserialized.fee_growth_global_a,
            whirlpool_fee_growth_global_a
        );
        assert_eq!(deserialized.token_mint_b, whirlpool_token_mint_b);
        assert_eq!(deserialized.token_vault_b, whirlpool_token_vault_b);
        assert_eq!(
            deserialized.fee_growth_global_b,
            whirlpool_fee_growth_global_b
        );
        assert_eq!(
            deserialized.reward_last_updated_timestamp,
            whirlpool_reward_last_updated_timestamp
        );
        for i in 0..NUM_REWARDS {
            assert_eq!(deserialized.reward_infos[i].mint, reward_info_mint);
            assert_eq!(deserialized.reward_infos[i].vault, reward_info_vault);
            assert_eq!(
                deserialized.reward_infos[i].authority,
                reward_info_authority
            );
            assert_eq!(
                deserialized.reward_infos[i].emissions_per_second_x64,
                reward_info_emissions_per_second_x64
            );
            assert_eq!(
                deserialized.reward_infos[i].growth_global_x64,
                reward_info_growth_global_x64
            );
        }

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();

        assert_eq!(serialized.as_slice(), whirlpool_data.as_ref());
    }
}
