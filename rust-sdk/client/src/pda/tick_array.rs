use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// A program_id of None resolves to the original whirlpool program id ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc")
pub fn get_tick_array_address(
    whirlpool: &Pubkey,
    start_tick_index: i32,
    program_id: Option<&Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let start_tick_index_str = start_tick_index.to_string();
    let seeds = &[
        b"tick_array",
        whirlpool.as_ref(),
        start_tick_index_str.as_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, program_id.unwrap_or(&WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_tick_array_address() {
        let whirlpool = Pubkey::from_str("2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS").unwrap();
        let tick_array = Pubkey::from_str("8PhPzk7n4wU98Z6XCbVtPai2LtXSxYnfjkmgWuoAU8Zy").unwrap();
        let (address, _) = get_tick_array_address(&whirlpool, 0, None).unwrap();
        assert_eq!(address, tick_array);
    }
}
