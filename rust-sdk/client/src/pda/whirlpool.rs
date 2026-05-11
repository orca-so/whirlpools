use crate::WhirlpoolDeployment;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the whirlpool PDA for the given mint pair and fee tier index under the supplied target program.
///
/// Uses [`WhirlpoolDeployment::default`] when `None`.
pub fn get_whirlpool_address(
    token_mint_a: &Pubkey,
    token_mint_b: &Pubkey,
    fee_tier_index: u16,
    whirlpool_deployment: Option<WhirlpoolDeployment>,
) -> Result<(Pubkey, u8), ProgramError> {
    let fee_tier_index_bytes = fee_tier_index.to_le_bytes();
    let whirlpool_deployment = whirlpool_deployment.unwrap_or_default();
    let whirlpools_config = whirlpool_deployment.config_address();
    let seeds = &[
        b"whirlpool",
        whirlpools_config.as_ref(),
        token_mint_a.as_ref(),
        token_mint_b.as_ref(),
        fee_tier_index_bytes.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &whirlpool_deployment.id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_whirlpool_address_mutable() {
        let token_mint_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let token_mint_b =
            Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap();
        let whirlpool = Pubkey::from_str("JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg").unwrap();
        let (address, _) = get_whirlpool_address(
            &token_mint_a,
            &token_mint_b,
            2,
            Some(WhirlpoolDeployment::mainnet()),
        )
        .unwrap();
        assert_eq!(address, whirlpool);
    }

    #[test]
    fn test_get_whirlpool_address_immutable() {
        let token_mint_a =
            Pubkey::from_str("CgH9igg7DmCYcQzh76o2VdcevuVmVUVAej7HcGeCwho2").unwrap();
        let token_mint_b =
            Pubkey::from_str("E3fyHm5B2ddYnCBgMpt3nVYMXxxLdSZTUCKt9GhLdfLc").unwrap();
        let whirlpool = Pubkey::from_str("DcMZ4NEbLkh7aAfy7Q4vPcAWVik6tSwfUf3FHDoRBvTG").unwrap();
        let (address, _) = get_whirlpool_address(
            &token_mint_a,
            &token_mint_b,
            1025,
            Some(WhirlpoolDeployment::mainnet_immutable()),
        )
        .unwrap();
        assert_eq!(address, whirlpool);
    }
}
