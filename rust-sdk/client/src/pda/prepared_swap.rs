use crate::WhirlpoolDeployment;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the prepared swap PDA for the given nonce under the supplied target program.
///
/// Uses [`WhirlpoolDeployment::default`] when `None`.
pub fn get_prepared_swap_address(
    nonce: u16,
    whirlpool_deployment: Option<WhirlpoolDeployment>,
) -> Result<(Pubkey, u8), ProgramError> {
    let whirlpool_deployment = whirlpool_deployment.unwrap_or_default();
    let seeds = &[
        b"prepared_swap".as_ref(),
        &nonce.to_le_bytes(),
    ];

    Pubkey::try_find_program_address(seeds, &whirlpool_deployment.id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_prepared_swap_address_mutable() {
        let prepared_swap = Pubkey::from_str("5nBgXtA9LneVzwF6ctH3bMP3iefmMGLETaVbctY7ZkHw").unwrap();
        let (address, _) = get_prepared_swap_address(0, Some(WhirlpoolDeployment::mainnet())).unwrap();
        assert_eq!(address, prepared_swap);
    }

    // Note: immutable whirlpool doesn't support this new feature because it is not upgradable...
}
