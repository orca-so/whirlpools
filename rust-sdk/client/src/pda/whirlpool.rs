use crate::generated::programs::current_whirlpool_id;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

pub fn get_whirlpool_address(
    whirlpools_config: &Pubkey,
    token_mint_a: &Pubkey,
    token_mint_b: &Pubkey,
    fee_tier_index: u16,
) -> Result<(Pubkey, u8), ProgramError> {
    let fee_tier_index_bytes = fee_tier_index.to_le_bytes();
    let seeds = &[
        b"whirlpool",
        whirlpools_config.as_ref(),
        token_mint_a.as_ref(),
        token_mint_b.as_ref(),
        fee_tier_index_bytes.as_ref(),
    ];

    Pubkey::try_find_program_address(seeds, &current_whirlpool_id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::programs::{set_whirlpool_program_raw, WhirlpoolProgram};
    use serial_test::serial;
    use std::str::FromStr;

    #[test]
    #[serial]
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

    #[test]
    #[serial]
    fn test_whirlpool_pda_changes_with_program_selector() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let token_mint_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let token_mint_b =
            Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap();

        let prev = set_whirlpool_program_raw(WhirlpoolProgram::Mutable);
        let (mutable_addr, _) =
            get_whirlpool_address(&whirlpools_config, &token_mint_a, &token_mint_b, 2).unwrap();

        set_whirlpool_program_raw(WhirlpoolProgram::Immutable);
        let (immutable_addr, _) =
            get_whirlpool_address(&whirlpools_config, &token_mint_a, &token_mint_b, 2).unwrap();

        // Restore so we don't leak global state into other tests.
        set_whirlpool_program_raw(WhirlpoolProgram::Address(prev));

        assert_ne!(mutable_addr, immutable_addr);
    }
}
