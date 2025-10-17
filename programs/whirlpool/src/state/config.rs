use crate::{errors::ErrorCode, math::MAX_PROTOCOL_FEE_RATE};
use anchor_lang::prelude::*;
use bitflags::bitflags;

#[derive(Copy, Clone, Default, Debug, PartialEq)]
pub struct ConfigFeatureFlags(u16);

bitflags! {
    impl ConfigFeatureFlags: u16 {
        const TOKEN_BADGE = 0b0000_0000_0000_0001;
    }
}

#[account]
pub struct WhirlpoolsConfig {
    pub fee_authority: Pubkey,
    pub collect_protocol_fees_authority: Pubkey,
    pub reward_emissions_super_authority: Pubkey,

    pub default_protocol_fee_rate: u16,
    pub feature_flags: u16, // ConfigFeatureFlags
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
        self.feature_flags = ConfigFeatureFlags::empty().bits();

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

    pub fn feature_flags(&self) -> ConfigFeatureFlags {
        ConfigFeatureFlags::from_bits_truncate(self.feature_flags)
    }

    pub fn update_feature_flags(&mut self, feature_flag: ConfigFeatureFlag) -> Result<()> {
        let mut feature_flags = self.feature_flags();
        match feature_flag {
            ConfigFeatureFlag::TokenBadge(enabled) => {
                feature_flags.set(ConfigFeatureFlags::TOKEN_BADGE, enabled);
            }
        }
        self.feature_flags = feature_flags.bits();
        Ok(())
    }

    pub fn verify_enabled_feature(&self, feature: ConfigFeatureFlags) -> Result<()> {
        if !self.feature_flags().contains(feature) {
            return Err(ErrorCode::FeatureIsNotEnabled.into());
        }
        Ok(())
    }
}

#[non_exhaustive]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum ConfigFeatureFlag {
    TokenBadge(bool),
}

#[cfg(test)]
mod discriminator_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_discriminator() {
        let discriminator = WhirlpoolsConfig::discriminator();
        // The discriminator is determined by the struct name and not depending on the program id.
        // $ echo -n account:WhirlpoolsConfig | sha256sum | cut -c 1-16
        // 9d1431e0d957c1fe
        assert_eq!(
            discriminator,
            [0x9d, 0x14, 0x31, 0xe0, 0xd9, 0x57, 0xc1, 0xfe]
        );
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
        let config_feature_flags: ConfigFeatureFlags = ConfigFeatureFlags::TOKEN_BADGE;

        let mut config_data = [0u8; WhirlpoolsConfig::LEN];
        let mut offset = 0;
        config_data[offset..offset + 8].copy_from_slice(&WhirlpoolsConfig::discriminator());
        offset += 8;
        config_data[offset..offset + 32].copy_from_slice(&config_fee_authority.to_bytes());
        offset += 32;
        config_data[offset..offset + 32]
            .copy_from_slice(&config_collect_protocol_fees_authority.to_bytes());
        offset += 32;
        config_data[offset..offset + 32]
            .copy_from_slice(&config_reward_emissions_super_authority.to_bytes());
        offset += 32;
        config_data[offset..offset + 2]
            .copy_from_slice(&config_default_protocol_fee_rate.to_le_bytes());
        offset += 2;
        config_data[offset..offset + 2].copy_from_slice(&config_feature_flags.bits().to_le_bytes());
        offset += 2;
        assert_eq!(offset, WhirlpoolsConfig::LEN);

        // deserialize
        let deserialized = WhirlpoolsConfig::try_deserialize(&mut config_data.as_ref()).unwrap();

        assert_eq!(config_fee_authority, deserialized.fee_authority);
        assert_eq!(
            config_collect_protocol_fees_authority,
            deserialized.collect_protocol_fees_authority
        );
        assert_eq!(
            config_reward_emissions_super_authority,
            deserialized.reward_emissions_super_authority
        );
        assert_eq!(
            config_default_protocol_fee_rate,
            deserialized.default_protocol_fee_rate
        );

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();

        assert_eq!(serialized.as_slice(), config_data.as_ref());
    }
}
