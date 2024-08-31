use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct TokenBadge {
    pub whirlpools_config: Pubkey, // 32
    pub token_mint: Pubkey,        // 32
                                   // 128 RESERVE
}

impl TokenBadge {
    pub const LEN: usize = 8 + 32 + 32 + 128;

    pub fn initialize(&mut self, whirlpools_config: Pubkey, token_mint: Pubkey) -> Result<()> {
        self.whirlpools_config = whirlpools_config;
        self.token_mint = token_mint;
        Ok(())
    }
}

#[cfg(test)]
mod token_badge_initialize_tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_default() {
        let token_badge = TokenBadge {
            ..Default::default()
        };
        assert_eq!(token_badge.whirlpools_config, Pubkey::default());
        assert_eq!(token_badge.token_mint, Pubkey::default());
    }

    #[test]
    fn test_initialize() {
        let mut token_badge = TokenBadge {
            ..Default::default()
        };
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let token_mint = Pubkey::from_str("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE").unwrap();

        let result = token_badge.initialize(whirlpools_config, token_mint);
        assert!(result.is_ok());

        assert_eq!(whirlpools_config, token_badge.whirlpools_config);
        assert_eq!(token_mint, token_badge.token_mint);
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_token_badge_data_layout() {
        let token_badge_whirlpools_config = Pubkey::new_unique();
        let token_badge_token_mint = Pubkey::new_unique();
        let token_badge_reserved = [0u8; 128];

        // manually build the expected data layout
        let mut token_badge_data = [0u8; TokenBadge::LEN];
        let mut offset = 0;
        token_badge_data[offset..offset + 8].copy_from_slice(&TokenBadge::discriminator());
        offset += 8;
        token_badge_data[offset..offset + 32]
            .copy_from_slice(&token_badge_whirlpools_config.to_bytes());
        offset += 32;
        token_badge_data[offset..offset + 32].copy_from_slice(&token_badge_token_mint.to_bytes());
        offset += 32;
        token_badge_data[offset..offset + token_badge_reserved.len()]
            .copy_from_slice(&token_badge_reserved);
        offset += token_badge_reserved.len();
        assert_eq!(offset, TokenBadge::LEN);

        // deserialize
        let deserialized = TokenBadge::try_deserialize(&mut token_badge_data.as_ref()).unwrap();

        assert_eq!(
            token_badge_whirlpools_config,
            deserialized.whirlpools_config
        );
        assert_eq!(token_badge_token_mint, deserialized.token_mint);

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();
        serialized.extend_from_slice(&token_badge_reserved);

        assert_eq!(serialized.as_slice(), token_badge_data.as_ref());
    }
}
