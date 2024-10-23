use crate::generated::programs::WHIRLPOOL_ID;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

pub fn get_oracle_address(whirlpool: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"oracle", whirlpool.as_ref()];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_oracle_address() {
        let whirlpool: Pubkey = "2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let oracle: Pubkey = "821SHenpVGYY7BCXUzNhs8Xi4grG557fqRw4wzgaPQcS"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let (address, _) = get_oracle_address(&whirlpool).unwrap();
        assert_eq!(address, oracle);
    }
}
