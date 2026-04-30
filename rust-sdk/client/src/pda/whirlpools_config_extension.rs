use crate::generated::programs::current_whirlpool_id;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

pub fn get_whirlpools_config_extension_address(
    whirlpools_config: &Pubkey,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"config_extension", whirlpools_config.as_ref()];

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
    fn test_get_whirlpools_config_extension_address() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let whirlpools_config_extension =
            Pubkey::from_str("777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH").unwrap();
        let (address, _) = get_whirlpools_config_extension_address(&whirlpools_config).unwrap();
        assert_eq!(address, whirlpools_config_extension);
    }
}
