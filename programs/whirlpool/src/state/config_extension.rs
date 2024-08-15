use anchor_lang::prelude::*;

#[account]
pub struct WhirlpoolsConfigExtension {
    pub whirlpools_config: Pubkey,          // 32
    pub config_extension_authority: Pubkey, // 32
    pub token_badge_authority: Pubkey,      // 32
                                            // 512 RESERVE
}

impl WhirlpoolsConfigExtension {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 512;

    pub fn initialize(
        &mut self,
        whirlpools_config: Pubkey,
        default_authority: Pubkey,
    ) -> Result<()> {
        self.whirlpools_config = whirlpools_config;
        self.config_extension_authority = default_authority;
        self.token_badge_authority = default_authority;
        Ok(())
    }

    pub fn update_config_extension_authority(&mut self, config_extension_authority: Pubkey) {
        self.config_extension_authority = config_extension_authority;
    }

    pub fn update_token_badge_authority(&mut self, token_badge_authority: Pubkey) {
        self.token_badge_authority = token_badge_authority;
    }
}

#[cfg(test)]
mod whirlpools_config_extension_initialize_tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_initialize() {
        let mut config_extension = WhirlpoolsConfigExtension {
            whirlpools_config: Pubkey::default(),
            config_extension_authority: Pubkey::default(),
            token_badge_authority: Pubkey::default(),
        };

        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let default_authority =
            Pubkey::from_str("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE").unwrap();

        let result = config_extension.initialize(whirlpools_config, default_authority);
        assert!(result.is_ok());

        assert_eq!(whirlpools_config, config_extension.whirlpools_config);
        assert_eq!(
            default_authority,
            config_extension.config_extension_authority
        );
        assert_eq!(default_authority, config_extension.token_badge_authority);
    }
}

#[cfg(test)]
mod whirlpools_config_extension_update_tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_update_config_extension_authority() {
        let mut config_extension = WhirlpoolsConfigExtension {
            whirlpools_config: Pubkey::default(),
            config_extension_authority: Pubkey::default(),
            token_badge_authority: Pubkey::default(),
        };

        let config_extension_authority =
            Pubkey::from_str("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE").unwrap();

        config_extension.update_config_extension_authority(config_extension_authority);

        assert_eq!(
            config_extension_authority,
            config_extension.config_extension_authority
        );
        assert_eq!(Pubkey::default(), config_extension.token_badge_authority);
    }

    #[test]
    fn test_update_token_badge_authority() {
        let mut config_extension = WhirlpoolsConfigExtension {
            whirlpools_config: Pubkey::default(),
            config_extension_authority: Pubkey::default(),
            token_badge_authority: Pubkey::default(),
        };

        let token_badge_authority =
            Pubkey::from_str("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE").unwrap();

        config_extension.update_token_badge_authority(token_badge_authority);

        assert_eq!(
            token_badge_authority,
            config_extension.token_badge_authority
        );
        assert_eq!(
            Pubkey::default(),
            config_extension.config_extension_authority
        );
    }
}
