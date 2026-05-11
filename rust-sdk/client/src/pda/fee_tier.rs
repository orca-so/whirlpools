use crate::WhirlpoolDeployment;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the fee tier PDA for the given fee tier index under the supplied target program.
///
/// Uses [`WhirlpoolDeployment::default`] when `None`.
pub fn get_fee_tier_address(
    fee_tier_index: u16,
    whirlpool_deployment: Option<WhirlpoolDeployment>,
) -> Result<(Pubkey, u8), ProgramError> {
    let whirlpool_deployment = whirlpool_deployment.unwrap_or_default();
    let whirlpools_config = whirlpool_deployment.config_address();
    let seeds = &[
        b"fee_tier",
        whirlpools_config.as_ref(),
        &fee_tier_index.to_le_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &whirlpool_deployment.id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_fee_tier_address_mutable() {
        let fee_tier = Pubkey::from_str("62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN").unwrap();
        let (address, _) = get_fee_tier_address(1, Some(WhirlpoolDeployment::mainnet())).unwrap();
        assert_eq!(address, fee_tier);
    }

    #[test]
    fn test_get_fee_tier_address_immutable() {
        let fee_tier = Pubkey::from_str("eDDRZSrsaprxbkmhRzDWY3gxAGKQj438e2TXcbobQME").unwrap();
        let (address, _) =
            get_fee_tier_address(1025, Some(WhirlpoolDeployment::mainnet_immutable())).unwrap();
        assert_eq!(address, fee_tier);
    }
}
