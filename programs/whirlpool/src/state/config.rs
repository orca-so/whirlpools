use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, math::MAX_PROTOCOL_FEE_RATE};

#[account]
pub struct WhirlpoolsConfig {
    pub fee_authority: Pubkey,
    pub collect_protocol_fees_authority: Pubkey,
    pub reward_emissions_super_authority: Pubkey,

    pub default_protocol_fee_rate: u16,
}

impl WhirlpoolsConfig {
    pub const LEN: usize = 8 + 96 + 4;

    pub fn update_fee_authority(&mut self, fee_authority: Pubkey) {
        self.fee_authority = fee_authority;
    }

    pub fn update_collect_protocol_fees_authority(
        &mut self,
        collect_protocol_fees_authority: Pubkey,
    ) {
        self.collect_protocol_fees_authority = collect_protocol_fees_authority;
    }

    pub fn initialize(
        &mut self,
        fee_authority: Pubkey,
        collect_protocol_fees_authority: Pubkey,
        reward_emissions_super_authority: Pubkey,
        default_protocol_fee_rate: u16,
    ) -> Result<()> {
        self.fee_authority = fee_authority;
        self.collect_protocol_fees_authority = collect_protocol_fees_authority;
        self.reward_emissions_super_authority = reward_emissions_super_authority;
        self.update_default_protocol_fee_rate(default_protocol_fee_rate)?;

        Ok(())
    }

    pub fn update_reward_emissions_super_authority(
        &mut self,
        reward_emissions_super_authority: Pubkey,
    ) {
        self.reward_emissions_super_authority = reward_emissions_super_authority;
    }

    pub fn update_default_protocol_fee_rate(
        &mut self,
        default_protocol_fee_rate: u16,
    ) -> Result<()> {
        if default_protocol_fee_rate > MAX_PROTOCOL_FEE_RATE {
            return Err(ErrorCode::ProtocolFeeRateMaxExceeded.into());
        }
        self.default_protocol_fee_rate = default_protocol_fee_rate;

        Ok(())
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_whirlpools_config_data_layout() {
        let config_fee_authority = Pubkey::new_unique();
        let config_collect_protocol_fees_authority = Pubkey::new_unique();
        let config_reward_emissions_super_authority = Pubkey::new_unique();
        let config_default_protocol_fee_rate = 0xffeeu16;
        let config_reserved = [0u8; 2];

        let mut config_data = [0u8; WhirlpoolsConfig::LEN];
        let mut offset = 0;
        config_data[offset..offset + 8].copy_from_slice(&WhirlpoolsConfig::discriminator());
        offset += 8;
        config_data[offset..offset + 32].copy_from_slice(&config_fee_authority.to_bytes());
        offset += 32;
        config_data[offset..offset + 32].copy_from_slice(&config_collect_protocol_fees_authority.to_bytes());
        offset += 32;
        config_data[offset..offset + 32].copy_from_slice(&config_reward_emissions_super_authority.to_bytes());
        offset += 32;
        config_data[offset..offset + 2].copy_from_slice(&config_default_protocol_fee_rate.to_le_bytes());
        offset += 2;
        config_data[offset..offset + config_reserved.len()].copy_from_slice(&config_reserved);
        offset += config_reserved.len();
        assert_eq!(offset, WhirlpoolsConfig::LEN);

        // deserialize
        let deserialized = WhirlpoolsConfig::try_deserialize(&mut config_data.as_ref()).unwrap();

        assert_eq!(config_fee_authority, deserialized.fee_authority);
        assert_eq!(config_collect_protocol_fees_authority, deserialized.collect_protocol_fees_authority);
        assert_eq!(config_reward_emissions_super_authority, deserialized.reward_emissions_super_authority);
        assert_eq!(config_default_protocol_fee_rate, deserialized.default_protocol_fee_rate);

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();
        serialized.extend_from_slice(&config_reserved);

        assert_eq!(serialized.as_slice(), config_data.as_ref());
   }
}
