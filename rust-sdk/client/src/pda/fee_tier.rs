use crate::TargetProgram;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the fee tier PDA for the given fee tier index under the supplied target program.
///
/// Passing `None` for `target_program` falls back to [`TargetProgram::default`] (the mutable
/// mainnet deployment).
pub fn get_fee_tier_address(
    target_program: Option<TargetProgram>,
    fee_tier_index: u16,
) -> Result<(Pubkey, u8), ProgramError> {
    let target_program = target_program.unwrap_or_default();
    let whirlpools_config = target_program.config_address();
    let seeds = &[
        b"fee_tier",
        whirlpools_config.as_ref(),
        &fee_tier_index.to_le_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &target_program.id()).ok_or(ProgramError::InvalidSeeds)
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
        let (address, _) = get_fee_tier_address(None, 1).unwrap();
        assert_eq!(address, fee_tier);
    }
}
