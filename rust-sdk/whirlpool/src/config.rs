use std::{error::Error, sync::Mutex};

use orca_whirlpools_client::get_whirlpools_config_extension_address;
use solana_program::pubkey::Pubkey;

/// The default address for the Whirlpools program's config account.
pub const DEFAULT_WHIRLPOOLS_CONFIG_ADDRESS: Pubkey = Pubkey::new_from_array([
    19, 228, 65, 248, 57, 19, 202, 104, 176, 99, 79, 176, 37, 253, 234, 168, 135, 55, 232, 65, 16,
    209, 37, 94, 53, 123, 51, 119, 221, 238, 28, 205,
]);

/// The default address for the Whirlpools program's config extension account.
pub const DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Pubkey = Pubkey::new_from_array([
    90, 182, 180, 56, 174, 38, 113, 211, 112, 187, 90, 174, 90, 115, 121, 167, 83, 122, 96, 10,
    152, 57, 209, 52, 207, 240, 174, 74, 201, 7, 87, 54,
]);

/// The currently selected address for the Whirlpools program's config account.
pub static WHIRLPOOLS_CONFIG_ADDRESS: Mutex<Pubkey> = Mutex::new(DEFAULT_WHIRLPOOLS_CONFIG_ADDRESS);

/// The currently selected address for the Whirlpools program's config extension account.
pub static WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS: Mutex<Pubkey> =
    Mutex::new(DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS);

/// Sets the currently selected address for the Whirlpools program's config account.
pub fn set_whirlpools_config_address(address: Pubkey) -> Result<(), Box<dyn Error>> {
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
    *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()? = DEFAULT_WHIRLPOOLS_CONFIG_ADDRESS;
    *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.try_lock()? = DEFAULT_WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS;
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
        set_whirlpools_config_address(new_config).unwrap();
        assert_eq!(*WHIRLPOOLS_CONFIG_ADDRESS.lock().unwrap(), new_config);
        assert_eq!(
            *WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS.lock().unwrap(),
            new_extension
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
