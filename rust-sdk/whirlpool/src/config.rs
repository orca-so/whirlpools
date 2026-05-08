use solana_pubkey::Pubkey;
use std::{error::Error, sync::Mutex};

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

/// The default setting for enforcing balance checks during token account preparation.
pub const DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK: bool = false;

/// The currently selected setting for enforcing balance checks during token account preparation.
/// When true, the system will assert that token accounts have sufficient balance before proceeding.
/// When false, balance checks are skipped, allowing users to get quotes and instructions even with insufficient balance.
pub static ENFORCE_TOKEN_BALANCE_CHECK: Mutex<bool> =
    Mutex::new(DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK);

/// Sets whether to enforce balance checks during token account preparation.
///
/// # Arguments
///
/// * `enforce_balance_check` - When true, the system will assert that token accounts have sufficient balance. When false, balance checks are skipped.
pub fn set_enforce_token_balance_check(enforce_balance_check: bool) -> Result<(), Box<dyn Error>> {
    *ENFORCE_TOKEN_BALANCE_CHECK.try_lock()? = enforce_balance_check;
    Ok(())
}

/// Resets the configuration to its default values.
pub fn reset_configuration() -> Result<(), Box<dyn Error>> {
    *FUNDER.try_lock()? = DEFAULT_FUNDER;
    *NATIVE_MINT_WRAPPING_STRATEGY.try_lock()? = DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;
    *SLIPPAGE_TOLERANCE_BPS.try_lock()? = DEFAULT_SLIPPAGE_TOLERANCE_BPS;
    *ENFORCE_TOKEN_BALANCE_CHECK.try_lock()? = DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::str::FromStr;

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
    fn test_set_enforce_token_balance_check() {
        set_enforce_token_balance_check(true).unwrap();
        assert!(*ENFORCE_TOKEN_BALANCE_CHECK.lock().unwrap());

        set_enforce_token_balance_check(false).unwrap();
        assert!(!(*ENFORCE_TOKEN_BALANCE_CHECK.lock().unwrap()));

        reset_configuration().unwrap();
    }

    #[test]
    #[serial]
    fn test_reset_configuration() {
        reset_configuration().unwrap();
        assert_eq!(*FUNDER.lock().unwrap(), Pubkey::default());
        assert_eq!(
            *NATIVE_MINT_WRAPPING_STRATEGY.lock().unwrap(),
            NativeMintWrappingStrategy::Keypair
        );
        assert_eq!(*SLIPPAGE_TOLERANCE_BPS.lock().unwrap(), 100);
        assert_eq!(
            *ENFORCE_TOKEN_BALANCE_CHECK.lock().unwrap(),
            DEFAULT_ENFORCE_TOKEN_BALANCE_CHECK
        );
    }
}
