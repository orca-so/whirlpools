use crate::TargetProgram;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the whirlpool PDA for the given mint pair and fee tier index under the supplied
/// target program.
///
/// Passing `None` for `target_program` falls back to [`TargetProgram::default`] (the mutable
/// mainnet deployment).
pub fn get_whirlpool_address(
    target_program: Option<TargetProgram>,
    token_mint_a: &Pubkey,
    token_mint_b: &Pubkey,
    fee_tier_index: u16,
) -> Result<(Pubkey, u8), ProgramError> {
    let fee_tier_index_bytes = fee_tier_index.to_le_bytes();
    let target_program = target_program.unwrap_or_default();
    let whirlpools_config = target_program.config_address();
    let seeds = &[
        b"whirlpool",
        whirlpools_config.as_ref(),
        token_mint_a.as_ref(),
        token_mint_b.as_ref(),
        fee_tier_index_bytes.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &target_program.id()).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    #[test]
    fn test_get_whirlpool_address() {
        let token_mint_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let token_mint_b =
            Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap();
        let whirlpool = Pubkey::from_str("JDQ9GDphXV5ENDrAQtRFvT98m3JwsVJJk8BYHoX8uTAg").unwrap();
        let (address, _) = get_whirlpool_address(None, &token_mint_a, &token_mint_b, 2).unwrap();
        assert_eq!(address, whirlpool);
    }
}
