use crate::TargetProgram;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the token badge PDA for the given mint under the supplied target program.
///
/// Passing `None` for `target_program` falls back to [`TargetProgram::default`] (the mutable
/// mainnet deployment).
pub fn get_token_badge_address(
    target_program: Option<TargetProgram>,
    token_mint: &Pubkey,
) -> Result<(Pubkey, u8), ProgramError> {
    let target_program = target_program.unwrap_or_default();
    let whirlpools_config = target_program.config_address();
    let seeds = &[
        b"token_badge",
        whirlpools_config.as_ref(),
        token_mint.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &target_program.id()).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_token_badge_address() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let token_mint = Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap();
        let token_badge = Pubkey::from_str("HX5iftnCxhtu11ys3ZuWbvUqo7cyPYaVNZBrLL67Hrbm").unwrap();
        let (address, _) = get_token_badge_address(None, &token_mint).unwrap();
        assert_eq!(address, token_badge);
    }
}
