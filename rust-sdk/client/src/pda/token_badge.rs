use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use crate::generated::programs::WHIRLPOOL_ID;

pub fn get_token_badge_address(
    whirlpools_config: &Pubkey,
    token_mint: &Pubkey,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"token_badge",
        whirlpools_config.as_ref(),
        token_mint.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID)
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_token_badge_address() {
        let whirlpools_config: Pubkey = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ".from_base58().unwrap().try_into().unwrap();
        let token_mint: Pubkey = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo".from_base58().unwrap().try_into().unwrap();
        let token_badge: Pubkey = "HX5iftnCxhtu11ys3ZuWbvUqo7cyPYaVNZBrLL67Hrbm".from_base58().unwrap().try_into().unwrap();
        let (address, _) = get_token_badge_address(&whirlpools_config, &token_mint).unwrap();
        assert_eq!(address, token_badge);
    }
}
