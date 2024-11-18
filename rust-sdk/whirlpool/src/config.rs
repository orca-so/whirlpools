use std::{error::Error, sync::Mutex};

use orca_whirlpools_client::get_whirlpools_config_extension_address;
use solana_program::pubkey::Pubkey;

/// The Whirlpools program's config account address for Solana Mainnet.
const SOLANA_MAINNET_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    19, 228, 65, 248, 57, 19, 202, 104, 176, 99, 79, 176, 37, 253, 234, 168, 135, 55, 232, 65, 16,
    209, 37, 94, 53, 123, 51, 119, 221, 238, 28, 205,
]);

/// The Whirlpools program's config account address for Solana Devnet.
const SOLANA_DEVNET_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    217, 51, 106, 61, 244, 143, 54, 30, 87, 6, 230, 156, 60, 182, 182, 217, 23, 116, 228, 121, 53,
    200, 82, 109, 229, 160, 245, 159, 33, 90, 35, 106,
]);

/// The Whirlpools program's config account address for Eclipse Mainnet.
const ECLIPSE_MAINNET_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    215, 64, 234, 8, 195, 52, 100, 209, 19, 230, 37, 101, 156, 135, 37, 41, 139, 254, 65, 104, 208,
    137, 96, 39, 84, 13, 60, 221, 36, 203, 151, 49,
]);

/// The Whirlpools program's config account address for Eclipse Testnet.
const ECLIPSE_TESTNET_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    213, 230, 107, 150, 137, 123, 254, 203, 164, 137, 81, 181, 70, 54, 172, 140, 176, 39, 16, 72,
    150, 84, 130, 137, 232, 108, 97, 236, 197, 119, 201, 83,
]);

/// The default address for the Whirlpools program's config extension account.
pub const SOLANA_MAINNET_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Pubkey = Pubkey::new_from_array([
    90, 182, 180, 56, 174, 38, 113, 211, 112, 187, 90, 174, 90, 115, 121, 167, 83, 122, 96, 10,
    152, 57, 209, 52, 207, 240, 174, 74, 201, 7, 87, 54,
]);

/// The currently selected address for the Whirlpools program's config account.
pub static WHIRLPOOLS_CONFIG_ADDRESS: Mutex<Pubkey> =
    Mutex::new(SOLANA_MAINNET_WHIRLPOOLS_CONFIG_ADDRESS);

/// The currently selected address for the Whirlpools program's config extension account.
pub static WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Mutex<Pubkey> =
    Mutex::new(SOLANA_MAINNET_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS);

/// Input type for setting the Whirlpools configuration.
pub enum WhirlpoolsConfigInput {
    Address(Pubkey),
    SolanaMainnet,
    SolanaDevnet,
    EclipseMainnet,
    EclipseTestnet,
}

impl From<Pubkey> for WhirlpoolsConfigInput {
    fn from(val: Pubkey) -> Self {
        WhirlpoolsConfigInput::Address(val)
    }
}

impl From<WhirlpoolsConfigInput> for Pubkey {
    fn from(val: WhirlpoolsConfigInput) -> Self {
        match val {
            WhirlpoolsConfigInput::Address(pubkey) => pubkey,
            WhirlpoolsConfigInput::SolanaMainnet => SOLANA_MAINNET_WHIRLPOOLS_CONFIG_ADDRESS,
            WhirlpoolsConfigInput::SolanaDevnet => SOLANA_DEVNET_WHIRLPOOLS_CONFIG_ADDRESS,
            WhirlpoolsConfigInput::EclipseMainnet => ECLIPSE_MAINNET_WHIRLPOOLS_CONFIG_ADDRESS,
            WhirlpoolsConfigInput::EclipseTestnet => ECLIPSE_TESTNET_WHIRLPOOLS_CONFIG_ADDRESS,
        }
    }
}

/// Sets the currently selected address for the Whirlpools program's config account.
pub fn set_whirlpools_config_address(input: WhirlpoolsConfigInput) -> Result<(), Box<dyn Error>> {
    let address: Pubkey = input.into();
    *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()? = address;
    *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.try_lock()? =
        get_whirlpools_config_extension_address(&address)?.0;
    Ok(())
}

/// The tick spacing for the SPLASH pool.
pub const SPLASH_POOL_TICK_SPACING: u16 = 32896;

/// The default funder for the Whirlpools program.
pub const DEFAULT_FUNDER: Pubkey = Pubkey::new_from_array([0; 32]);

/// The currently selected funder for the Whirlpools program.
pub static FUNDER: Mutex<Pubkey> = Mutex::new(DEFAULT_FUNDER);

/// Sets the currently selected funder for the Whirlpools program.
pub fn set_funder(funder: Pubkey) -> Result<(), Box<dyn Error>> {
    *FUNDER.try_lock()? = funder;
    Ok(())
}

/// The default slippage tolerance, expressed in basis points. Value of 100 is equivalent to 1%.
pub const DEFAULT_SLIPPAGE_TOLERANCE_BPS: u16 = 100;

/// The currently selected slippage tolerance, expressed in basis points.
pub static SLIPPAGE_TOLERANCE_BPS: Mutex<u16> = Mutex::new(DEFAULT_SLIPPAGE_TOLERANCE_BPS);

/// Sets the currently selected slippage tolerance, expressed in basis points.
pub fn set_slippage_tolerance_bps(tolerance: u16) -> Result<(), Box<dyn Error>> {
    *SLIPPAGE_TOLERANCE_BPS.try_lock()? = tolerance;
    Ok(())
}

/// Defines the strategy for handling SOL wrapping in a transaction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeMintWrappingStrategy {
    /// Creates an auxiliary token account using a keypair.
    /// Optionally adds funds to the account.
    /// Closes it at the end of the transaction.
    Keypair,
    /// Functions similarly to Keypair, but uses a seed account instead.
    Seed,
    /// Treats the native balance and associated token account (ATA) for `NATIVE_MINT` as one.
    /// Will create the ATA if it doesn't exist.
    /// Optionally adds funds to the account.
    /// Closes it at the end of the transaction if it did not exist before.
    Ata,
    /// Uses or creates the ATA without performing any SOL wrapping or unwrapping.
    None,
}

/// The default SOL wrapping strategy.
pub const DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY: NativeMintWrappingStrategy =
    NativeMintWrappingStrategy::Keypair;

/// The currently selected SOL wrapping strategy.
pub static NATIVE_MINT_WRAPPING_STRATEGY: Mutex<NativeMintWrappingStrategy> =
    Mutex::new(DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY);

/// Sets the currently selected SOL wrapping strategy.
pub fn set_native_mint_wrapping_strategy(
    strategy: NativeMintWrappingStrategy,
) -> Result<(), Box<dyn Error>> {
    *NATIVE_MINT_WRAPPING_STRATEGY.try_lock()? = strategy;
    Ok(())
}

/// Resets the configuration to its default values.
pub fn reset_configuration() -> Result<(), Box<dyn Error>> {
    *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()? = SOLANA_MAINNET_WHIRLPOOLS_CONFIG_ADDRESS;
    *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.try_lock()? =
        SOLANA_MAINNET_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS;
    *FUNDER.try_lock()? = DEFAULT_FUNDER;
    *NATIVE_MINT_WRAPPING_STRATEGY.try_lock()? = DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;
    *SLIPPAGE_TOLERANCE_BPS.try_lock()? = DEFAULT_SLIPPAGE_TOLERANCE_BPS;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::str::FromStr;

    #[test]
    #[serial]
    fn test_set_whirlpools_config_address() {
        let new_config = Pubkey::from_str("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E").unwrap();
        let new_extension =
            Pubkey::from_str("Ez4MMUVb7VrKFcTSbi9Yz2ivXwdwCqJicnDaRHbe96Yk").unwrap();
        set_whirlpools_config_address(new_config.into()).unwrap();
        assert_eq!(*WHIRLPOOLS_CONFIG_ADDRESS.lock().unwrap(), new_config);
        assert_eq!(
            *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.lock().unwrap(),
            new_extension
        );
        reset_configuration().unwrap();
    }

    #[test]
    #[serial]
    fn test_set_whirlpools_config_address_by_network() {
        use std::str::FromStr;
        let expected_config =
            Pubkey::from_str("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR").unwrap(); // Replace with actual base58 value for the array
        let expected_extension =
            Pubkey::from_str("475EJ7JqnRpVLoFVzp2ruEYvWWMCf6Z8KMWRujtXXNSU").unwrap(); // Replace with the expected extension
        set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
        assert_eq!(*WHIRLPOOLS_CONFIG_ADDRESS.lock().unwrap(), expected_config);
        assert_eq!(
            *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.lock().unwrap(),
            expected_extension
        );
        reset_configuration().unwrap();
    }

    #[test]
    #[serial]
    fn test_set_funder() {
        let new_funder = Pubkey::from_str("GdDMspJi2oQaKDtABKE24wAQgXhGBoxq8sC21st7GJ3E").unwrap();
        set_funder(new_funder).unwrap();
        assert_eq!(*FUNDER.lock().unwrap(), new_funder);
        reset_configuration().unwrap();
    }

    #[test]
    #[serial]
    fn test_set_sol_wrapping_strategy() {
        let new_strategy = NativeMintWrappingStrategy::Ata;
        set_native_mint_wrapping_strategy(new_strategy).unwrap();
        assert_eq!(*NATIVE_MINT_WRAPPING_STRATEGY.lock().unwrap(), new_strategy);
        reset_configuration().unwrap();
    }

    #[test]
    #[serial]
    fn test_set_slippage_tolerance_bps() {
        let new_tolerance = 200;
        set_slippage_tolerance_bps(new_tolerance).unwrap();
        assert_eq!(*SLIPPAGE_TOLERANCE_BPS.lock().unwrap(), new_tolerance);
        reset_configuration().unwrap();
    }

    #[test]
    #[serial]
    fn test_reset_configuration() {
        let config = Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap();
        let extension = Pubkey::from_str("777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH").unwrap();
        reset_configuration().unwrap();
        assert_eq!(*WHIRLPOOLS_CONFIG_ADDRESS.lock().unwrap(), config);
        assert_eq!(
            *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.lock().unwrap(),
            extension
        );
        assert_eq!(*FUNDER.lock().unwrap(), Pubkey::default());
        assert_eq!(
            *NATIVE_MINT_WRAPPING_STRATEGY.lock().unwrap(),
            NativeMintWrappingStrategy::Keypair
        );
        assert_eq!(*SLIPPAGE_TOLERANCE_BPS.lock().unwrap(), 100);
    }
}
