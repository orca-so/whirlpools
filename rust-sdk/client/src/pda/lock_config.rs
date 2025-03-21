use crate::generated::programs::WHIRLPOOL_ID;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

pub fn get_lock_config_address(position: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"lock_config", position.as_ref()];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_lock_config_address() {
        let lock_config = Pubkey::from_str("3MaMYjnnqyZSs5kD7vbPKTyx3RkD6qHuSF94kvvKukKx").unwrap();
        let position = Pubkey::from_str("2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq").unwrap();
        let (address, _) = get_lock_config_address(&position).unwrap();
        assert_eq!(address, lock_config);
    }
}
