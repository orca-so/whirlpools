use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the position bundle PDA for the given position mint under the supplied target program.
///
/// Uses the mutable Whirlpool program ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc") when `None`.
pub fn get_position_bundle_address(
    position_mint: &Pubkey,
    program_id: Option<Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"position_bundle", position_mint.as_ref()];

    Pubkey::try_find_program_address(seeds, &program_id.unwrap_or(WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

/// Derives the bundled position PDA for the given position bundle address and bundle index under the supplied target program.
///
/// Uses the mutable Whirlpool program ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc") when `None`.
pub fn get_bundled_position_address(
    position_bundle_address: &Pubkey,
    bundle_index: u8,
    program_id: Option<Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let bundle_index_str = bundle_index.to_string();
    let seeds = &[
        b"bundled_position",
        position_bundle_address.as_ref(),
        bundle_index_str.as_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &program_id.unwrap_or(WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WhirlpoolDeployment;
    use std::str::FromStr;

    #[test]
    fn test_get_position_bundle_address_mutable() {
        let position_mint =
            Pubkey::from_str("6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p").unwrap();
        let position_bundle =
            Pubkey::from_str("At1QvbnANV6imkdNkfB4h1XsY4jbTzPAmScgjLCnM7jy").unwrap();
        let (address, _) =
            get_position_bundle_address(&position_mint, Some(WhirlpoolDeployment::mainnet().id()))
                .unwrap();
        assert_eq!(address, position_bundle);
    }

    #[test]
    fn test_get_position_bundle_address_immutable() {
        let position_mint =
            Pubkey::from_str("6LdmNS8p3qLYrGcPeYby6zHRvZPq7cYDZTiBXCC3FNDs").unwrap();
        let position_bundle =
            Pubkey::from_str("CVTZ5u8yjGngtpZ5WRx536ty8jiMCFkzwrr5TJW5FpR7").unwrap();
        let (address, _) = get_position_bundle_address(
            &position_mint,
            Some(WhirlpoolDeployment::mainnet_immutable().id()),
        )
        .unwrap();
        assert_eq!(address, position_bundle);
    }

    #[test]
    fn test_get_bundled_position_address_mutable() {
        let position_bundle_address =
            Pubkey::from_str("6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p").unwrap();
        let bundled_position =
            Pubkey::from_str("9Zj8oWYVQdBCtqMn9Z3YyGo8o7hVXLEUZ5x5no5ykVm6").unwrap();
        let (address, _) = get_bundled_position_address(
            &position_bundle_address,
            0,
            Some(WhirlpoolDeployment::mainnet().id()),
        )
        .unwrap();
        assert_eq!(address, bundled_position);
    }

    #[test]
    fn test_get_bundled_position_address_immutable() {
        let position_bundle_address =
            Pubkey::from_str("28nFQJH8FHYxUvXc5orSZzcjmzWoByvzfBwi75Ep3f9u").unwrap();
        let bundled_position =
            Pubkey::from_str("Ew84d962t5uHAnwKifZyotxmxjrZ5xokCtgtxD1ToRzh").unwrap();
        let (address, _) = get_bundled_position_address(
            &position_bundle_address,
            0,
            Some(WhirlpoolDeployment::mainnet_immutable().id()),
        )
        .unwrap();
        assert_eq!(address, bundled_position);
    }
}
