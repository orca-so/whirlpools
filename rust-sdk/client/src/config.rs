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
