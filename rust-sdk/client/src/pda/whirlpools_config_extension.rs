use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// A program_id of None resolves to the original whirlpool program id ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc")
pub fn get_whirlpools_config_extension_address(
    whirlpools_config: &Pubkey,
    program_id: Option<&Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"config_extension", whirlpools_config.as_ref()];

    Pubkey::try_find_program_address(seeds, program_id.unwrap_or(&WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_whirlpools_config_extension_address() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let whirlpools_config_extension =
            Pubkey::from_str("777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH").unwrap();
        let (address, _) =
            get_whirlpools_config_extension_address(&whirlpools_config, None).unwrap();
        assert_eq!(address, whirlpools_config_extension);
    }
}
