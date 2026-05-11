use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the oracle PDA for the given whirlpool under the supplied target program.
///
/// Uses the mutable Whirlpool program ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc") when `None`.
pub fn get_oracle_address(
    whirlpool: &Pubkey,
    program_id: Option<Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"oracle", whirlpool.as_ref()];

    Pubkey::try_find_program_address(seeds, &program_id.unwrap_or(WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WhirlpoolDeployment;
    use std::str::FromStr;

    #[test]
    fn test_get_oracle_address_mutable() {
        let whirlpool = Pubkey::from_str("2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS").unwrap();
        let oracle = Pubkey::from_str("821SHenpVGYY7BCXUzNhs8Xi4grG557fqRw4wzgaPQcS").unwrap();
        let (address, _) =
            get_oracle_address(&whirlpool, Some(WhirlpoolDeployment::mainnet().id())).unwrap();
        assert_eq!(address, oracle);
    }

    #[test]
    fn test_get_oracle_address_immutable() {
        let whirlpool = Pubkey::from_str("DcMZ4NEbLkh7aAfy7Q4vPcAWVik6tSwfUf3FHDoRBvTG").unwrap();
        let oracle = Pubkey::from_str("F7hHjRkVMEGsgEgyF1N9RrQKBPSU5QL1xmKGCYUwBY9M").unwrap();
        let (address, _) = get_oracle_address(
            &whirlpool,
            Some(WhirlpoolDeployment::mainnet_immutable().id()),
        )
        .unwrap();
        assert_eq!(address, oracle);
    }
}
