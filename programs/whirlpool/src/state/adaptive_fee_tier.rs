use crate::errors::ErrorCode;
use crate::math::MAX_FEE_RATE;
use crate::state::WhirlpoolsConfig;
use anchor_lang::prelude::*;

use super::AdaptiveFeeConstants;

#[account]
pub struct AdaptiveFeeTier {
    pub whirlpools_config: Pubkey,
    pub fee_tier_index: u16,

    pub tick_spacing: u16,

    // authority who can use this adaptive fee tier
    pub initialize_pool_authority: Pubkey,

    // delegation
    pub delegated_fee_authority: Pubkey,

    // base fee
    pub default_base_fee_rate: u16,

    // adaptive fee constants
    pub filter_period: u16,
    pub decay_period: u16,
    pub reduction_factor: u16,
    pub adaptive_fee_control_factor: u32,
    pub max_volatility_accumulator: u32,
    pub tick_group_size: u16,
    // 256 RESERVE
}

impl AdaptiveFeeTier {
    pub const LEN: usize = 8 + 32 + 2 + 2 + 32 + 32 + 2 + 2 + 2 + 2 + 4 + 4 + 2 + 256;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        whirlpools_config: &Account<WhirlpoolsConfig>,
        fee_tier_index: u16,
        tick_spacing: u16,
        initialize_pool_authority: Pubkey,
        delegated_fee_authority: Pubkey,
        default_base_fee_rate: u16,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
    ) -> Result<()> {
        if fee_tier_index == tick_spacing {
            // fee_tier_index == tick_spacing is reserved for FeeTier account
            return Err(ErrorCode::InvalidFeeTierIndex.into());
        }

        self.whirlpools_config = whirlpools_config.key();
        self.fee_tier_index = fee_tier_index;

        self.tick_spacing = tick_spacing;

        self.initialize_pool_authority = initialize_pool_authority;

        self.delegated_fee_authority = delegated_fee_authority;

        self.default_base_fee_rate = default_base_fee_rate;

        self.update_adaptive_fee_constants(
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        )?;

        Ok(())
    }

    pub fn update_initialize_pool_authority(&mut self, initialize_pool_authority: Pubkey) {
        self.initialize_pool_authority = initialize_pool_authority;
    }

    pub fn update_delegated_fee_authority(&mut self, delegated_fee_authority: Pubkey) {
        self.delegated_fee_authority = delegated_fee_authority;
    }

    pub fn update_default_base_fee_rate(&mut self, default_base_fee_rate: u16) -> Result<()> {
        if default_base_fee_rate > MAX_FEE_RATE {
            return Err(ErrorCode::FeeRateMaxExceeded.into());
        }
        self.default_base_fee_rate = default_base_fee_rate;

        Ok(())
    }

    pub fn update_adaptive_fee_constants(
        &mut self,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
    ) -> Result<()> {
        if !AdaptiveFeeConstants::validate_constants(
            self.tick_spacing,
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        ) {
            return Err(ErrorCode::InvalidAdaptiveFeeConstants.into());
        }

        self.filter_period = filter_period;
        self.decay_period = decay_period;
        self.reduction_factor = reduction_factor;
        self.adaptive_fee_control_factor = adaptive_fee_control_factor;
        self.max_volatility_accumulator = max_volatility_accumulator;
        self.tick_group_size = tick_group_size;

        Ok(())
    }

    pub fn is_valid_initialize_pool_authority(&self, initialize_pool_authority: Pubkey) -> bool {
        // no authority is set (permissionless)
        if self.initialize_pool_authority == Pubkey::default() {
            return true;
        }
        self.initialize_pool_authority == initialize_pool_authority
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    // TODO: modify
    /*
    #[test]
    fn test_adaptive_fee_config_data_layout() {
        let whirlpools_config = Pubkey::new_unique();
        let tick_spacing = 0xffu16;

        let default_filter_period = 0x1122u16;
        let default_decay_period = 0x3344u16;
        let default_reduction_factor = 0x5566u16;
        let default_adaptive_fee_control_factor = 0x778899aau32;
        let default_max_volatility_accumulator = 0xbbccddeeu32;
        let default_tick_group_size = 0xff00u16;

        let mut adaptive_fee_config_data = [0u8; AdaptiveFeeTier::LEN];
        let mut offset = 0;
        adaptive_fee_config_data[offset..offset + 8]
            .copy_from_slice(&AdaptiveFeeTier::discriminator());
        offset += 8;
        adaptive_fee_config_data[offset..offset + 32]
            .copy_from_slice(&whirlpools_config.to_bytes());
        offset += 32;
        adaptive_fee_config_data[offset..offset + 2].copy_from_slice(&tick_spacing.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 2]
            .copy_from_slice(&default_filter_period.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 2]
            .copy_from_slice(&default_decay_period.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 2]
            .copy_from_slice(&default_reduction_factor.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 4]
            .copy_from_slice(&default_adaptive_fee_control_factor.to_le_bytes());
        offset += 4;
        adaptive_fee_config_data[offset..offset + 4]
            .copy_from_slice(&default_max_volatility_accumulator.to_le_bytes());
        offset += 4;
        adaptive_fee_config_data[offset..offset + 2]
            .copy_from_slice(&default_tick_group_size.to_le_bytes());
        offset += 2;
        assert_eq!(offset, AdaptiveFeeTier::LEN);

        // deserialize
        let deserialized =
            AdaptiveFeeTier::try_deserialize(&mut adaptive_fee_config_data.as_ref()).unwrap();

        assert_eq!(whirlpools_config, deserialized.whirlpools_config);
        assert_eq!(tick_spacing, deserialized.tick_spacing);
        assert_eq!(default_filter_period, deserialized.default_filter_period);
        assert_eq!(default_decay_period, deserialized.default_decay_period);
        assert_eq!(
            default_reduction_factor,
            deserialized.default_reduction_factor
        );
        assert_eq!(
            default_adaptive_fee_control_factor,
            deserialized.default_adaptive_fee_control_factor
        );
        assert_eq!(
            default_max_volatility_accumulator,
            deserialized.default_max_volatility_accumulator
        );
        assert_eq!(
            default_tick_group_size,
            deserialized.default_tick_group_size
        );

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();

        assert_eq!(serialized.as_slice(), adaptive_fee_config_data.as_ref());
    }
    */
}
