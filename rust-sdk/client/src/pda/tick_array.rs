use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use crate::generated::programs::WHIRLPOOL_ID;

pub fn get_tick_array_address(
    whirlpool: &Pubkey,
    start_tick_index: i32,
) -> Result<(Pubkey, u8), ProgramError> {
    let start_tick_index_str = start_tick_index.to_string();
    let seeds = &[
        b"tick_array",
        whirlpool.as_ref(),
        start_tick_index_str.as_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID)
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_tick_array_address() {
        let whirlpool: Pubkey = "2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS".from_base58().unwrap().try_into().unwrap();
        let tick_array: Pubkey = "7me8W7puQ5tNA15r7ocNX9tFQD9pwtzFDTSdHMMSmDRt".from_base58().unwrap().try_into().unwrap();
        let (address, _) = get_tick_array_address(&whirlpool, -2894848).unwrap();
        assert_eq!(address, tick_array);
    }
}
