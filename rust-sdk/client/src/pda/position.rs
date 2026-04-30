use crate::generated::programs::current_whirlpool_id;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

pub fn get_position_address(position_mint: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"position", position_mint.as_ref()];

    Pubkey::try_find_program_address(seeds, &current_whirlpool_id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::str::FromStr;

    #[test]
    #[serial]
    fn test_get_position_address() {
        let position_mint =
            Pubkey::from_str("6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p").unwrap();
        let position = Pubkey::from_str("2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq").unwrap();
        let (address, _) = get_position_address(&position_mint).unwrap();
        assert_eq!(address, position);
    }
}
