use crate::program_id::current_whirlpool_id;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

pub fn get_fee_tier_address(
    whirlpools_config: &Pubkey,
    fee_tier_index: u16,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"fee_tier",
        whirlpools_config.as_ref(),
        &fee_tier_index.to_le_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &current_whirlpool_id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::str::FromStr;

    #[test]
    #[serial]
    fn test_get_fee_tier_address() {
        let whirlpools_config =
            Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let fee_tier = Pubkey::from_str("62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN").unwrap();
        let (address, _) = get_fee_tier_address(&whirlpools_config, 1).unwrap();
        assert_eq!(address, fee_tier);
    }
}
