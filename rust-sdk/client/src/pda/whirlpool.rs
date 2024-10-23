use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use crate::generated::programs::WHIRLPOOL_ID;

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

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID)
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_whirlpool_address() {
        let whirlpools_config: Pubkey = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ".from_base58().unwrap().try_into().unwrap();
        let token_mint_a: Pubkey = "So11111111111111111111111111111111111111112".from_base58().unwrap().try_into().unwrap();
        let token_mint_b: Pubkey = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo".from_base58().unwrap().try_into().unwrap();
        let whirlpool: Pubkey = "JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg".from_base58().unwrap().try_into().unwrap();
        let (address, _) = get_whirlpool_address(&whirlpools_config, &token_mint_a, &token_mint_b, 2).unwrap();
        assert_eq!(address, whirlpool);
    }
}
