use crate::program_id::current_whirlpool_id;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

pub fn get_oracle_address(whirlpool: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"oracle", whirlpool.as_ref()];

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
    fn test_get_oracle_address() {
        let whirlpool = Pubkey::from_str("2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS").unwrap();
        let oracle = Pubkey::from_str("821SHenpVGYY7BCXUzNhs8Xi4grG557fqRw4wzgaPQcS").unwrap();
        let (address, _) = get_oracle_address(&whirlpool).unwrap();
        assert_eq!(address, oracle);
    }
}
