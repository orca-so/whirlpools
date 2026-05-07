use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// A program_id of None resolves to the original whirlpool program id ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc")
pub fn get_fee_tier_address(
    whirlpools_config: &Pubkey,
    fee_tier_index: u16,
    program_id: Option<&Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"fee_tier",
        whirlpools_config.as_ref(),
        &fee_tier_index.to_le_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, program_id.unwrap_or(&WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_fee_tier_address() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let fee_tier = Pubkey::from_str("62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN").unwrap();
        let (address, _) = get_fee_tier_address(&whirlpools_config, 1, None).unwrap();
        assert_eq!(address, fee_tier);
    }
}
