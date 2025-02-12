use crate::state::WhirlpoolsConfig;
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

use super::{AdaptiveFeeConstants, FeeTier};

#[account]
pub struct AdaptiveFeeConfig {
    pub whirlpools_config: Pubkey,
    pub tick_spacing: u16,

    pub default_filter_period: u16,
    pub default_decay_period: u16,
    pub default_reduction_factor: u16,
    pub default_adaptive_fee_control_factor: u32,
    pub default_max_volatility_accumulator: u32,
    pub default_tick_group_size: u16,

    // TODO: DELEGATE
    // TODO: RESERVE
}

impl AdaptiveFeeConfig {
    pub const LEN: usize = 8 + 32 + 2 + 2 + 2 + 2 + 4 + 4 + 2;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        whirlpools_config: &Account<WhirlpoolsConfig>,
        fee_tier: &Account<FeeTier>,
        default_filter_period: u16,
        default_decay_period: u16,
        default_reduction_factor: u16,
        default_adaptive_fee_control_factor: u32,
        default_max_volatility_accumulator: u32,
        default_tick_group_size: u16,
    ) -> Result<()> {
        self.whirlpools_config = whirlpools_config.key();
        self.tick_spacing = fee_tier.tick_spacing;

        self.update_adaptive_fee_constants(
            default_filter_period,
            default_decay_period,
            default_reduction_factor,
            default_adaptive_fee_control_factor,
            default_max_volatility_accumulator,
            default_tick_group_size
        )?;

        Ok(())
    }

    pub fn update_adaptive_fee_constants(
        &mut self,
        default_filter_period: u16,
        default_decay_period: u16,
        default_reduction_factor: u16,
        default_adaptive_fee_control_factor: u32,
        default_max_volatility_accumulator: u32,
        default_tick_group_size: u16,
    ) -> Result<()> {
        if !AdaptiveFeeConstants::validate_constants(
            self.tick_spacing,
            default_filter_period,
            default_decay_period,
            default_reduction_factor,
            default_adaptive_fee_control_factor,
            default_max_volatility_accumulator,
            default_tick_group_size,
        ) {
            return Err(ErrorCode::InvalidAdaptiveFeeConstants.into());
        }

        self.default_filter_period = default_filter_period;
        self.default_decay_period = default_decay_period;
        self.default_reduction_factor = default_reduction_factor;
        self.default_adaptive_fee_control_factor = default_adaptive_fee_control_factor;
        self.default_max_volatility_accumulator = default_max_volatility_accumulator;
        self.default_tick_group_size = default_tick_group_size;

        Ok(())
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

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

        let mut adaptive_fee_config_data = [0u8; AdaptiveFeeConfig::LEN];
        let mut offset = 0;
        adaptive_fee_config_data[offset..offset + 8].copy_from_slice(&AdaptiveFeeConfig::discriminator());
        offset += 8;
        adaptive_fee_config_data[offset..offset + 32].copy_from_slice(&whirlpools_config.to_bytes());
        offset += 32;
        adaptive_fee_config_data[offset..offset + 2].copy_from_slice(&tick_spacing.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 2].copy_from_slice(&default_filter_period.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 2].copy_from_slice(&default_decay_period.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 2].copy_from_slice(&default_reduction_factor.to_le_bytes());
        offset += 2;
        adaptive_fee_config_data[offset..offset + 4].copy_from_slice(&default_adaptive_fee_control_factor.to_le_bytes());
        offset += 4;
        adaptive_fee_config_data[offset..offset + 4].copy_from_slice(&default_max_volatility_accumulator.to_le_bytes());
        offset += 4;
        adaptive_fee_config_data[offset..offset + 2].copy_from_slice(&default_tick_group_size.to_le_bytes());
        offset += 2;
        assert_eq!(offset, AdaptiveFeeConfig::LEN);

        // deserialize
        let deserialized = AdaptiveFeeConfig::try_deserialize(&mut adaptive_fee_config_data.as_ref()).unwrap();

        assert_eq!(whirlpools_config, deserialized.whirlpools_config);
        assert_eq!(tick_spacing, deserialized.tick_spacing);
        assert_eq!(default_filter_period, deserialized.default_filter_period);
        assert_eq!(default_decay_period, deserialized.default_decay_period);
        assert_eq!(default_reduction_factor, deserialized.default_reduction_factor);
        assert_eq!(default_adaptive_fee_control_factor, deserialized.default_adaptive_fee_control_factor);
        assert_eq!(default_max_volatility_accumulator, deserialized.default_max_volatility_accumulator);
        assert_eq!(default_tick_group_size, deserialized.default_tick_group_size);

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();

        assert_eq!(serialized.as_slice(), adaptive_fee_config_data.as_ref());
    }
}
