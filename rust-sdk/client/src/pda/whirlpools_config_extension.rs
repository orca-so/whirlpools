use crate::WhirlpoolDeployment;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// Derives the whirlpool config extension PDA under the supplied target program.
pub fn get_whirlpools_config_extension_address(
    whirlpool_deployment: WhirlpoolDeployment,
) -> Result<(Pubkey, u8), ProgramError> {
    let whirlpools_config = whirlpool_deployment.config_address();
    let seeds = &[b"config_extension", whirlpools_config.as_ref()];

    Pubkey::try_find_program_address(seeds, &whirlpool_deployment.id())
        .ok_or(ProgramError::InvalidSeeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_get_whirlpools_config_extension_address_mutable() {
        let whirlpools_config_extension =
            Pubkey::from_str("777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH").unwrap();
        let (address, _) =
            get_whirlpools_config_extension_address(WhirlpoolDeployment::mainnet()).unwrap();
        assert_eq!(address, whirlpools_config_extension);
    }

    #[test]
    fn test_get_whirlpools_config_extension_address_immutable() {
        let whirlpools_config_extension =
            Pubkey::from_str("4Bsw8VVuegLmKQh2reevMBr2xw5R76WaJRKCvvxgcQrN").unwrap();
        let (address, _) =
            get_whirlpools_config_extension_address(WhirlpoolDeployment::mainnet_immutable())
                .unwrap();
        assert_eq!(address, whirlpools_config_extension);
    }
}
