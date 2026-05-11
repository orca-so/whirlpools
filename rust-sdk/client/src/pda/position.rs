use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the position PDA for the given position mint under the supplied target program.
///
/// Uses the mutable Whirlpool program ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc") when `None`.
pub fn get_position_address(
    position_mint: &Pubkey,
    program_id: Option<Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"position", position_mint.as_ref()];

    Pubkey::try_find_program_address(seeds, &program_id.unwrap_or(WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WhirlpoolDeployment;
    use std::str::FromStr;

    #[test]
    fn test_get_position_address_mutable() {
        let position_mint =
            Pubkey::from_str("6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p").unwrap();
        let position = Pubkey::from_str("2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq").unwrap();
        let (address, _) =
            get_position_address(&position_mint, Some(WhirlpoolDeployment::mainnet().id()))
                .unwrap();
        assert_eq!(address, position);
    }

    #[test]
    fn test_get_position_address_immutable() {
        let position_mint =
            Pubkey::from_str("6LdmNS8p3qLYrGcPeYby6zHRvZPq7cYDZTiBXCC3FNDs").unwrap();
        let position = Pubkey::from_str("28nFQJH8FHYxUvXc5orSZzcjmzWoByvzfBwi75Ep3f9u").unwrap();
        let (address, _) = get_position_address(
            &position_mint,
            Some(WhirlpoolDeployment::mainnet_immutable().id()),
        )
        .unwrap();
        assert_eq!(address, position);
    }
}
