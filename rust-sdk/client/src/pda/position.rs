use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use crate::generated::programs::WHIRLPOOL_ID;

pub fn get_position_address(
    position_mint: &Pubkey,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"position",
        position_mint.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID)
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_position_address() {
        let position_mint: Pubkey = "6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p".from_base58().unwrap().try_into().unwrap();
        let position: Pubkey = "2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq".from_base58().unwrap().try_into().unwrap();
        let (address, _) = get_position_address(&position_mint).unwrap();
        assert_eq!(address, position);
    }
}
