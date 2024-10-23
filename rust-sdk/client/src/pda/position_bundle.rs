use crate::generated::programs::WHIRLPOOL_ID;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

pub fn get_position_bundle_address(position_mint: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"position_bundle", position_mint.as_ref()];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
}

pub fn get_bundled_position_address(
    position_bundle_address: &Pubkey,
    bundle_index: u8,
) -> Result<(Pubkey, u8), ProgramError> {
    let bundle_index_str = bundle_index.to_string();
    let seeds = &[
        b"bundled_position",
        position_bundle_address.as_ref(),
        bundle_index_str.as_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_position_bundle_address() {
        let position_mint: Pubkey = "6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let position_bundle: Pubkey = "At1QvbnANV6imkdNkfB4h1XsY4jbTzPAmScgjLCnM7jy"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let (address, _) = get_position_bundle_address(&position_mint).unwrap();
        assert_eq!(address, position_bundle);
    }

    #[test]
    fn test_get_bundled_position_address() {
        let position_bundle_address: Pubkey = "6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let bundled_position: Pubkey = "9Zj8oWYVQdBCtqMn9Z3YyGo8o7hVXLEUZ5x5no5ykVm6"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let (address, _) = get_bundled_position_address(&position_bundle_address, 0).unwrap();
        assert_eq!(address, bundled_position);
    }
}
