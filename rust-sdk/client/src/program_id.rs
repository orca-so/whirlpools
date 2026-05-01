//! Runtime-selectable Whirlpool program ID.
//!
//! Lives outside `src/generated/` because the codama renderer wipes any
//! file in that directory that isn't part of its output set. The generated
//! instruction builders and PDA helpers call [`current_whirlpool_id`] (re-
//! exported at the crate root) so the same SDK can target the canonical
//! (mutable) deployment, the immutable deployment, or an arbitrary forked
//! program without recompiling.

use solana_pubkey::{pubkey, Pubkey};
use std::sync::Mutex;

/// `whirlpool` program ID (canonical, upgradable deployment).
pub const WHIRLPOOL_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

/// Immutable Whirlpool program ID. Bytecode-identical to [`WHIRLPOOL_ID`],
/// deployed as a non-upgradable program.
pub const WHIRLPOOL_IMMUTABLE_ID: Pubkey = pubkey!("iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN");

/// Selector for which Whirlpool program the SDK should target at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhirlpoolProgram {
    /// Canonical upgradable program at [`WHIRLPOOL_ID`].
    Mutable,
    /// Immutable program at [`WHIRLPOOL_IMMUTABLE_ID`].
    Immutable,
    /// Arbitrary program address (forks, localnet, custom deployments).
    Address(Pubkey),
}

impl From<WhirlpoolProgram> for Pubkey {
    fn from(value: WhirlpoolProgram) -> Self {
        match value {
            WhirlpoolProgram::Mutable => WHIRLPOOL_ID,
            WhirlpoolProgram::Immutable => WHIRLPOOL_IMMUTABLE_ID,
            WhirlpoolProgram::Address(addr) => addr,
        }
    }
}

static CURRENT_WHIRLPOOL_PROGRAM_ID: Mutex<Pubkey> = Mutex::new(WHIRLPOOL_ID);

/// Returns the currently selected Whirlpool program address.
pub fn current_whirlpool_id() -> Pubkey {
    *CURRENT_WHIRLPOOL_PROGRAM_ID
        .lock()
        .expect("whirlpool program selector poisoned")
}

/// Sets the Whirlpool program address used by every generated SDK builder and
/// PDA helper. Returns the previously selected address.
///
/// Most callers should use [`orca_whirlpools::set_whirlpool_program`] instead
/// — that wrapper also resets `WHIRLPOOLS_CONFIG_ADDRESS` and
/// `WHIRLPOOLS_CONFIG_EXTENSION_ADDRESS` to the canonical pair for the
/// selected program. This raw setter only flips the program ID and is
/// intended for the high-level wrapper, tests, and advanced callers that
/// manage the config addresses themselves.
pub fn set_whirlpool_program_raw(program: WhirlpoolProgram) -> Pubkey {
    let next: Pubkey = program.into();
    let mut slot = CURRENT_WHIRLPOOL_PROGRAM_ID
        .lock()
        .expect("whirlpool program selector poisoned");
    let prev = *slot;
    *slot = next;
    prev
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::str::FromStr;

    /// Ensures we never accidentally re-point the canonical address.
    #[test]
    fn whirlpool_id_matches_canonical_pubkey() {
        assert_eq!(
            WHIRLPOOL_ID,
            Pubkey::from_str("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc").unwrap(),
        );
    }

    /// Ensures we never accidentally re-point the immutable address. This
    /// pubkey is wire-visible and changing it is a breaking SDK change.
    #[test]
    fn whirlpool_immutable_id_matches_canonical_pubkey() {
        assert_eq!(
            WHIRLPOOL_IMMUTABLE_ID,
            Pubkey::from_str("iwhrLHdsgrvmnwU8GF2FSmyabSMjfHwFGJAX2ufJ3ZN").unwrap(),
        );
    }

    #[test]
    fn whirlpool_id_and_immutable_id_are_distinct() {
        assert_ne!(WHIRLPOOL_ID, WHIRLPOOL_IMMUTABLE_ID);
    }

    #[test]
    fn whirlpool_program_variants_resolve_to_expected_addresses() {
        assert_eq!(Pubkey::from(WhirlpoolProgram::Mutable), WHIRLPOOL_ID);
        assert_eq!(
            Pubkey::from(WhirlpoolProgram::Immutable),
            WHIRLPOOL_IMMUTABLE_ID,
        );
        let custom = Pubkey::new_unique();
        assert_eq!(Pubkey::from(WhirlpoolProgram::Address(custom)), custom);
    }

    #[test]
    #[serial]
    fn current_whirlpool_id_defaults_to_mutable() {
        let prev = set_whirlpool_program_raw(WhirlpoolProgram::Mutable);
        assert_eq!(current_whirlpool_id(), WHIRLPOOL_ID);
        set_whirlpool_program_raw(WhirlpoolProgram::Address(prev));
    }

    #[test]
    #[serial]
    fn set_whirlpool_program_returns_previous_address() {
        let baseline = set_whirlpool_program_raw(WhirlpoolProgram::Mutable);

        let returned = set_whirlpool_program_raw(WhirlpoolProgram::Immutable);
        assert_eq!(returned, WHIRLPOOL_ID);

        let returned = set_whirlpool_program_raw(WhirlpoolProgram::Mutable);
        assert_eq!(returned, WHIRLPOOL_IMMUTABLE_ID);

        set_whirlpool_program_raw(WhirlpoolProgram::Address(baseline));
    }

    #[test]
    #[serial]
    fn set_whirlpool_program_handles_custom_address() {
        let baseline = set_whirlpool_program_raw(WhirlpoolProgram::Mutable);

        let custom = Pubkey::from_str("11111111111111111111111111111111").unwrap();
        let returned = set_whirlpool_program_raw(WhirlpoolProgram::Address(custom));
        assert_eq!(returned, WHIRLPOOL_ID);
        assert_eq!(current_whirlpool_id(), custom);

        set_whirlpool_program_raw(WhirlpoolProgram::Address(baseline));
        assert_eq!(current_whirlpool_id(), WHIRLPOOL_ID);
    }

    #[test]
    #[serial]
    fn round_trip_mutable_immutable_mutable_returns_to_default() {
        let baseline = set_whirlpool_program_raw(WhirlpoolProgram::Mutable);
        set_whirlpool_program_raw(WhirlpoolProgram::Immutable);
        assert_eq!(current_whirlpool_id(), WHIRLPOOL_IMMUTABLE_ID);
        set_whirlpool_program_raw(WhirlpoolProgram::Mutable);
        assert_eq!(current_whirlpool_id(), WHIRLPOOL_ID);
        set_whirlpool_program_raw(WhirlpoolProgram::Address(baseline));
    }
}
