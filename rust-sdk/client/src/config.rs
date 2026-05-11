use solana_pubkey::Pubkey;

/// The Whirlpools program's address for Solana Mainnet.
const WHIRLPOOLS_PROGRAM_ADDRESS: Pubkey = Pubkey::new_from_array([
    14, 3, 104, 95, 142, 144, 144, 83, 228, 88, 18, 28, 102, 245, 167, 106, 237, 199, 112, 106,
    161, 28, 130, 248, 170, 149, 42, 143, 43, 120, 121, 169,
]);

/// The Whirlpools program's config account address for Solana Mainnet.
const MAINNET_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    19, 228, 65, 248, 57, 19, 202, 104, 176, 99, 79, 176, 37, 253, 234, 168, 135, 55, 232, 65, 16,
    209, 37, 94, 53, 123, 51, 119, 221, 238, 28, 205,
]);

/// The Whirlpools program's config account address for Solana Devnet.
const DEVNET_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    217, 51, 106, 61, 244, 143, 54, 30, 87, 6, 230, 156, 60, 182, 182, 217, 23, 116, 228, 121, 53,
    200, 82, 109, 229, 160, 245, 159, 33, 90, 35, 106,
]);

/// The Immutable Whirlpools program's address for Solana Mainnet.
const IMMUTABLE_WHIRLPOOLS_PROGRAM_ADDRESS: Pubkey = Pubkey::new_from_array([
    10, 190, 170, 228, 40, 106, 177, 83, 26, 168, 255, 237, 218, 124, 243, 187, 165, 111, 204, 10,
    122, 36, 151, 91, 167, 129, 193, 156, 224, 11, 227, 101,
]);

/// The Immutable Whirlpools program's config account address for Solana Mainnet.
const MAINNET_IMMUTABLE_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    116, 62, 1, 180, 69, 120, 160, 190, 89, 235, 62, 144, 64, 210, 160, 63, 11, 157, 46, 125, 206,
    46, 108, 53, 135, 184, 54, 34, 43, 41, 184, 124,
]);

/// Identifies a deployed whirlpool program and the config account it operates against.
///
/// PDA derivation and instruction targeting both depend on these two values, so they are
/// bundled together to keep them consistent. Pass a `WhirlpoolDeployment` (or `None` to fall back
/// to [`WhirlpoolDeployment::default`], which is the mutable mainnet program) to the SDK functions
/// and PDA helpers that accept it.
///
/// Use the named constructors ([`WhirlpoolDeployment::mainnet`], [`WhirlpoolDeployment::devnet`],
/// [`WhirlpoolDeployment::mainnet_immutable`]) for the official deployments, or
/// [`WhirlpoolDeployment::custom`] to point at a fork or local deployment.
#[derive(Debug, Clone, Copy)]
pub struct WhirlpoolDeployment {
    program_id: Pubkey,
    config: Pubkey,
}

impl WhirlpoolDeployment {
    /// Returns the program id of the targeted whirlpool program.
    pub fn id(&self) -> Pubkey {
        self.program_id
    }

    /// Returns the `WhirlpoolsConfig` account address that pairs with this program.
    pub fn config_address(&self) -> Pubkey {
        self.config
    }

    /// The mutable whirlpool program on Solana Mainnet, paired with its mainnet config account.
    pub fn mainnet() -> Self {
        Self {
            program_id: WHIRLPOOLS_PROGRAM_ADDRESS,
            config: MAINNET_WHIRLPOOLS_CONFIG_ADDRESS,
        }
    }

    /// The mutable whirlpool program on Solana Devnet, paired with its devnet config account.
    pub fn devnet() -> Self {
        Self {
            program_id: WHIRLPOOLS_PROGRAM_ADDRESS,
            config: DEVNET_WHIRLPOOLS_CONFIG_ADDRESS,
        }
    }

    /// The immutable whirlpool program on Solana Mainnet, paired with its mainnet config account.
    pub fn mainnet_immutable() -> Self {
        Self {
            program_id: IMMUTABLE_WHIRLPOOLS_PROGRAM_ADDRESS,
            config: MAINNET_IMMUTABLE_WHIRLPOOLS_CONFIG_ADDRESS,
        }
    }

    /// Targets an arbitrary `program_id` / `config` pair — useful for forks, local validators,
    /// or any deployment not covered by the named constructors.
    pub fn custom(program_id: Pubkey, config: Pubkey) -> Self {
        Self { program_id, config }
    }
}

impl Default for WhirlpoolDeployment {
    /// Defaults to the mutable mainnet deployment ([`WhirlpoolDeployment::mainnet`]).
    fn default() -> Self {
        Self::mainnet()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    const MAINNET_PROGRAM: &str = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
    const MAINNET_CONFIG: &str = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ";
    const DEVNET_CONFIG: &str = "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR";
    const IMMUTABLE_PROGRAM: &str = "iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN";
    const IMMUTABLE_MAINNET_CONFIG: &str = "8pm8erUsaMpmZ47LttHAPgnDx7xGZUvxY4q47vTCs5Nj";

    #[test]
    fn mainnet_targets_mutable_program_and_mainnet_config() {
        let deployment = WhirlpoolDeployment::mainnet();
        assert_eq!(deployment.id(), Pubkey::from_str(MAINNET_PROGRAM).unwrap());
        assert_eq!(
            deployment.config_address(),
            Pubkey::from_str(MAINNET_CONFIG).unwrap()
        );
    }

    #[test]
    fn devnet_targets_mutable_program_and_devnet_config() {
        let deployment = WhirlpoolDeployment::devnet();
        assert_eq!(
            deployment.id(),
            Pubkey::from_str(MAINNET_PROGRAM).unwrap(),
            "devnet reuses the mutable mainnet program id"
        );
        assert_eq!(
            deployment.config_address(),
            Pubkey::from_str(DEVNET_CONFIG).unwrap()
        );
    }

    #[test]
    fn mainnet_immutable_targets_immutable_program_and_its_config() {
        let deployment = WhirlpoolDeployment::mainnet_immutable();
        assert_eq!(
            deployment.id(),
            Pubkey::from_str(IMMUTABLE_PROGRAM).unwrap()
        );
        assert_eq!(
            deployment.config_address(),
            Pubkey::from_str(IMMUTABLE_MAINNET_CONFIG).unwrap()
        );
    }

    #[test]
    fn default_matches_mainnet() {
        let default = WhirlpoolDeployment::default();
        let mainnet = WhirlpoolDeployment::mainnet();
        assert_eq!(default.id(), mainnet.id());
        assert_eq!(default.config_address(), mainnet.config_address());
    }

    #[test]
    fn custom_returns_supplied_pubkeys() {
        let program_id = Pubkey::from_str("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E").unwrap();
        let config = Pubkey::from_str("2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS").unwrap();
        let deployment = WhirlpoolDeployment::custom(program_id, config);
        assert_eq!(deployment.id(), program_id);
        assert_eq!(deployment.config_address(), config);
    }

    #[test]
    fn custom_can_reconstruct_named_deployments() {
        let mainnet = WhirlpoolDeployment::mainnet();
        let rebuilt = WhirlpoolDeployment::custom(mainnet.id(), mainnet.config_address());
        assert_eq!(rebuilt.id(), mainnet.id());
        assert_eq!(rebuilt.config_address(), mainnet.config_address());
    }

    #[test]
    fn named_deployments_are_distinct() {
        let mainnet = WhirlpoolDeployment::mainnet();
        let devnet = WhirlpoolDeployment::devnet();
        let immutable = WhirlpoolDeployment::mainnet_immutable();

        assert_ne!(mainnet.config_address(), devnet.config_address());
        assert_ne!(mainnet.id(), immutable.id());
        assert_ne!(mainnet.config_address(), immutable.config_address());
        assert_ne!(devnet.config_address(), immutable.config_address());
    }
}
