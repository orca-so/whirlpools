use crate::state::WhirlpoolsConfig;
use crate::{errors::ErrorCode, math::MAX_FEE_RATE};
use anchor_lang::prelude::*;

#[account]
pub struct FeeTier {
    pub whirlpools_config: Pubkey,
    pub tick_spacing: u16,
    pub default_fee_rate: u16,
}

impl FeeTier {
    pub const LEN: usize = 8 + 32 + 4;

    pub fn initialize(
        &mut self,
        whirlpools_config: &Account<WhirlpoolsConfig>,
        tick_spacing: u16,
        default_fee_rate: u16,
    ) -> Result<()> {
        self.whirlpools_config = whirlpools_config.key();
        self.tick_spacing = tick_spacing;
        self.update_default_fee_rate(default_fee_rate)?;
        Ok(())
    }

    pub fn update_default_fee_rate(&mut self, default_fee_rate: u16) -> Result<()> {
        if default_fee_rate > MAX_FEE_RATE {
            return Err(ErrorCode::FeeRateMaxExceeded.into());
        }
        self.default_fee_rate = default_fee_rate;

        Ok(())
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_fee_tier_data_layout() {
        let fee_tier_whirlpools_config = Pubkey::new_unique();
        let fee_tier_tick_spacing = 0xffu16;
        let fee_tier_default_fee_rate = 0x22u16;

        let mut fee_tier_data = [0u8; FeeTier::LEN];
        let mut offset = 0;
        fee_tier_data[offset..offset + 8].copy_from_slice(&FeeTier::discriminator());
        offset += 8;
        fee_tier_data[offset..offset + 32].copy_from_slice(&fee_tier_whirlpools_config.to_bytes());
        offset += 32;
        fee_tier_data[offset..offset + 2].copy_from_slice(&fee_tier_tick_spacing.to_le_bytes());
        offset += 2;
        fee_tier_data[offset..offset + 2].copy_from_slice(&fee_tier_default_fee_rate.to_le_bytes());
        offset += 2;
        assert_eq!(offset, FeeTier::LEN);

        // deserialize
        let deserialized = FeeTier::try_deserialize(&mut fee_tier_data.as_ref()).unwrap();

        assert_eq!(fee_tier_whirlpools_config, deserialized.whirlpools_config);
        assert_eq!(fee_tier_tick_spacing, deserialized.tick_spacing);
        assert_eq!(fee_tier_default_fee_rate, deserialized.default_fee_rate);

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();

        assert_eq!(serialized.as_slice(), fee_tier_data.as_ref());
    }
}