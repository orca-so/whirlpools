use crate::generated::programs::WHIRLPOOL_ID;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

pub fn get_fee_tier_address(
    whirlpools_config: &Pubkey,
    tick_spacing: u16,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[
        b"fee_tier",
        whirlpools_config.as_ref(),
        &tick_spacing.to_le_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &WHIRLPOOL_ID).ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base58::FromBase58;

    #[test]
    fn test_get_fee_tier_address() {
        let whirlpools_config: Pubkey = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let fee_tier: Pubkey = "62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN"
            .from_base58()
            .unwrap()
            .try_into()
            .unwrap();
        let (address, _) = get_fee_tier_address(&whirlpools_config, 1).unwrap();
        assert_eq!(address, fee_tier);
    }
}
