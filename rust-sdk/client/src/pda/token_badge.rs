use crate::WhirlpoolDeployment;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the token badge PDA for the given mint under the supplied target program.
///
/// Uses [`WhirlpoolDeployment::default`] when `None`.
pub fn get_token_badge_address(
    token_mint: &Pubkey,
    whirlpool_deployment: Option<WhirlpoolDeployment>,
) -> Result<(Pubkey, u8), ProgramError> {
    let whirlpool_deployment = whirlpool_deployment.unwrap_or_default();
    let whirlpools_config = whirlpool_deployment.config_address();
    let seeds = &[
        b"token_badge",
        whirlpools_config.as_ref(),
        token_mint.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &whirlpool_deployment.id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_token_badge_address_mutable() {
        let token_mint = Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap();
        let token_badge = Pubkey::from_str("HX5iftnCxhtu11ys3ZuWbvUqo7cyPYaVNZBrLL67Hrbm").unwrap();
        let (address, _) =
            get_token_badge_address(&token_mint, Some(WhirlpoolDeployment::mainnet())).unwrap();
        assert_eq!(address, token_badge);
    }

    #[test]
    fn test_get_token_badge_address_immutable() {
        let token_mint = Pubkey::from_str("CgH9igg7DmCYcQzh76o2VdcevuVmVUVAej7HcGeCwho2").unwrap();
        let token_badge = Pubkey::from_str("DsFspoBifWBAZTqo2c6JEXxqxYEuDyNbr8tgATgRYCBu").unwrap();
        let (address, _) =
            get_token_badge_address(&token_mint, Some(WhirlpoolDeployment::mainnet_immutable()))
                .unwrap();
        assert_eq!(address, token_badge);
    }
}
