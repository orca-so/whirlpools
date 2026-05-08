use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

use crate::TargetProgram;

/// Derives the whirlpools config extension PDA under the supplied target program.
///
/// Passing `None` for `target_program` falls back to [`TargetProgram::default`] (the mutable
/// mainnet deployment).
pub fn get_whirlpools_config_extension_address(
    target_program: Option<TargetProgram>,
) -> Result<(Pubkey, u8), ProgramError> {
    let target_program = target_program.unwrap_or_default();
    let whirlpools_config = target_program.config_address();
    let seeds = &[b"config_extension", whirlpools_config.as_ref()];

    Pubkey::try_find_program_address(seeds, &target_program.id()).ok_or(ProgramError::InvalidSeeds)
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
        let (address, _) = get_whirlpools_config_extension_address(None).unwrap();
        assert_eq!(address, whirlpools_config_extension);
    }
}
