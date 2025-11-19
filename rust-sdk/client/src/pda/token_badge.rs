use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

pub fn get_token_badge_address(
    whirlpools_config: &Pubkey,
    token_mint: &Pubkey,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"token_badge",
        whirlpools_config.as_ref(),
        token_mint.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
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
        let (address, _) = get_token_badge_address(&whirlpools_config, &token_mint).unwrap();
        assert_eq!(address, token_badge);
    }
}
