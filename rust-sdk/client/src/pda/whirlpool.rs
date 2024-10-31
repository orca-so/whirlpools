use crate::generated::programs::WHIRLPOOL_ID;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

pub fn get_whirlpool_address(
    whirlpools_config: &Pubkey,
    token_mint_a: &Pubkey,
    token_mint_b: &Pubkey,
    tick_spacing: u16,
) -> Result<(Pubkey, u8), ProgramError> {
    let tick_spacing_bytes = tick_spacing.to_le_bytes();
    let seeds = &[
        b"whirlpool",
        whirlpools_config.as_ref(),
        token_mint_a.as_ref(),
        token_mint_b.as_ref(),
        tick_spacing_bytes.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    #[test]
    fn test_get_whirlpool_address() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let token_mint_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let token_mint_b =
            Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap();
        let whirlpool = Pubkey::from_str("JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg").unwrap();
        let (address, _) =
            get_whirlpool_address(&whirlpools_config, &token_mint_a, &token_mint_b, 2).unwrap();
        assert_eq!(address, whirlpool);
    }
}
