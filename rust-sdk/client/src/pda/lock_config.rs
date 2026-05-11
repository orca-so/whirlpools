use crate::generated::programs::WHIRLPOOL_ID;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the lock config PDA for the given position under the supplied target program.
///
/// Uses the mutable Whirlpool program ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc") when `None`.
pub fn get_lock_config_address(
    position: &Pubkey,
    program_id: Option<Pubkey>,
) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"lock_config", position.as_ref()];

    Pubkey::try_find_program_address(seeds, &program_id.unwrap_or(WHIRLPOOL_ID))
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WhirlpoolDeployment;
    use std::str::FromStr;

    #[test]
    fn test_get_lock_config_address_mutable() {
        let lock_config = Pubkey::from_str("3MaMYjnnqyZSs5kD7vbPKTyx3RkD6qHuSF94kvvKukKx").unwrap();
        let position = Pubkey::from_str("2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq").unwrap();
        let (address, _) =
            get_lock_config_address(&position, Some(WhirlpoolDeployment::mainnet().id())).unwrap();
        assert_eq!(address, lock_config);
    }

    #[test]
    fn test_get_lock_config_address_immutable() {
        let lock_config = Pubkey::from_str("3k4JPPrK1yiEZUgHWugbckRkkUrpnnCA4ujmerJzxENU").unwrap();
        let position = Pubkey::from_str("6LdmNS8p3qLYrGcPeYby6zHRvZPq7cYDZTiBXCC3FNDs").unwrap();
        let (address, _) = get_lock_config_address(
            &position,
            Some(WhirlpoolDeployment::mainnet_immutable().id()),
        )
        .unwrap();
        assert_eq!(address, lock_config);
    }
}
