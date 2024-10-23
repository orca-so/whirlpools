use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use crate::generated::programs::WHIRLPOOL_ID;

pub fn get_whirlpools_config_extension_address(
  whirlpools_config: &Pubkey,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"config_extension",
        whirlpools_config.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID)
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_whirlpools_config_extension_address() {
        let whirlpools_config: Pubkey = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ".from_base58().unwrap().try_into().unwrap();
        let whirlpools_config_extension: Pubkey = "777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH".from_base58().unwrap().try_into().unwrap();
        let (address, _) = get_whirlpools_config_extension_address(&whirlpools_config).unwrap();
        assert_eq!(address, whirlpools_config_extension);
    }
}
