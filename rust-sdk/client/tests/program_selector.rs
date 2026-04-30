//! Cross-cutting tests for the runtime Whirlpool program selector.
//!
//! Lives as an integration test (separate binary) so unit tests in `src/`
//! that observe the global through `current_whirlpool_id()` aren't affected
//! by the mutations performed here. Within this binary, every test still
//! runs serially because they all share the same process-wide global.

use orca_whirlpools_client::{
    current_whirlpool_id, get_bundled_position_address, get_fee_tier_address,
    get_lock_config_address, get_oracle_address, get_position_address, get_position_bundle_address,
    get_tick_array_address, get_token_badge_address, get_whirlpool_address,
    get_whirlpools_config_extension_address, set_whirlpool_program_raw, InitializePool,
    InitializePoolInstructionArgs, SetDefaultFeeRate, SetDefaultFeeRateInstructionArgs,
    WhirlpoolProgram, WHIRLPOOL_ID, WHIRLPOOL_IMMUTABLE_ID,
};
use serial_test::serial;
use solana_pubkey::Pubkey;
use std::str::FromStr;

/// Save the selector on entry, run `body` against a flipped selector, and
/// restore on exit. Avoids leaking state between tests in this binary.
fn with_program<F: FnOnce()>(program: WhirlpoolProgram, body: F) {
    let previous = set_whirlpool_program_raw(program);
    body();
    set_whirlpool_program_raw(WhirlpoolProgram::Address(previous));
}

fn whirlpools_config() -> Pubkey {
    Pubkey::from_str("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ").unwrap()
}

fn token_mint_a() -> Pubkey {
    Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap()
}

fn token_mint_b() -> Pubkey {
    Pubkey::from_str("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo").unwrap()
}

fn arbitrary_position() -> Pubkey {
    Pubkey::from_str("2EtH4ZZStW8Ffh2CbbW4baekdtWgPLcBXfYQ6FRmMVsq").unwrap()
}

fn arbitrary_whirlpool() -> Pubkey {
    Pubkey::from_str("2kJmUjxWBwL2NGPBV2PiA5hWtmLCqcKY6reQgkrPtaeS").unwrap()
}

fn arbitrary_mint() -> Pubkey {
    Pubkey::from_str("6sf6fSK6tTubFA2LMCeTzt4c6DeNVyA6WpDDgtWs7a5p").unwrap()
}

#[test]
#[serial]
fn pda_helpers_all_flip_with_selector() {
    set_whirlpool_program_raw(WhirlpoolProgram::Mutable);

    let mutable_addresses = [
        get_whirlpool_address(&whirlpools_config(), &token_mint_a(), &token_mint_b(), 2)
            .unwrap()
            .0,
        get_fee_tier_address(&whirlpools_config(), 1).unwrap().0,
        get_oracle_address(&arbitrary_whirlpool()).unwrap().0,
        get_position_address(&arbitrary_mint()).unwrap().0,
        get_position_bundle_address(&arbitrary_mint()).unwrap().0,
        get_bundled_position_address(&arbitrary_mint(), 0)
            .unwrap()
            .0,
        get_tick_array_address(&arbitrary_whirlpool(), 0).unwrap().0,
        get_token_badge_address(&whirlpools_config(), &token_mint_b())
            .unwrap()
            .0,
        get_lock_config_address(&arbitrary_position()).unwrap().0,
        get_whirlpools_config_extension_address(&whirlpools_config())
            .unwrap()
            .0,
    ];

    set_whirlpool_program_raw(WhirlpoolProgram::Immutable);

    let immutable_addresses = [
        get_whirlpool_address(&whirlpools_config(), &token_mint_a(), &token_mint_b(), 2)
            .unwrap()
            .0,
        get_fee_tier_address(&whirlpools_config(), 1).unwrap().0,
        get_oracle_address(&arbitrary_whirlpool()).unwrap().0,
        get_position_address(&arbitrary_mint()).unwrap().0,
        get_position_bundle_address(&arbitrary_mint()).unwrap().0,
        get_bundled_position_address(&arbitrary_mint(), 0)
            .unwrap()
            .0,
        get_tick_array_address(&arbitrary_whirlpool(), 0).unwrap().0,
        get_token_badge_address(&whirlpools_config(), &token_mint_b())
            .unwrap()
            .0,
        get_lock_config_address(&arbitrary_position()).unwrap().0,
        get_whirlpools_config_extension_address(&whirlpools_config())
            .unwrap()
            .0,
    ];

    set_whirlpool_program_raw(WhirlpoolProgram::Mutable);

    // Every helper must derive a different address on the immutable program.
    // If any pair collides we've either lost the program-id binding inside
    // that helper or the two programs accidentally share a PDA, both of which
    // are bugs.
    for (i, (a, b)) in mutable_addresses
        .iter()
        .zip(immutable_addresses.iter())
        .enumerate()
    {
        assert_ne!(
            a, b,
            "PDA helper #{i} did not flip when the selector changed; the helper is still bound to the previous program",
        );
    }
}

#[test]
#[serial]
fn pda_helpers_match_when_selector_is_restored() {
    set_whirlpool_program_raw(WhirlpoolProgram::Mutable);
    let baseline = get_whirlpool_address(&whirlpools_config(), &token_mint_a(), &token_mint_b(), 2)
        .unwrap()
        .0;

    set_whirlpool_program_raw(WhirlpoolProgram::Immutable);
    set_whirlpool_program_raw(WhirlpoolProgram::Mutable);

    let after_restore =
        get_whirlpool_address(&whirlpools_config(), &token_mint_a(), &token_mint_b(), 2)
            .unwrap()
            .0;
    assert_eq!(baseline, after_restore);
}

#[test]
#[serial]
fn instruction_builder_program_id_tracks_selector() {
    let accounts = SetDefaultFeeRate {
        whirlpools_config: whirlpools_config(),
        fee_tier: Pubkey::from_str("62dSkn5ktwY1PoKPNMArZA4bZsvyemuknWUnnQ2ATTuN").unwrap(),
        fee_authority: Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(),
    };
    let args = SetDefaultFeeRateInstructionArgs {
        default_fee_rate: 30,
    };

    with_program(WhirlpoolProgram::Mutable, || {
        let ix = accounts.instruction(args.clone());
        assert_eq!(ix.program_id, WHIRLPOOL_ID);
    });

    with_program(WhirlpoolProgram::Immutable, || {
        let ix = accounts.instruction(args.clone());
        assert_eq!(ix.program_id, WHIRLPOOL_IMMUTABLE_ID);
    });

    let custom = Pubkey::from_str("11111111111111111111111111111111").unwrap();
    with_program(WhirlpoolProgram::Address(custom), || {
        let ix = accounts.instruction(args.clone());
        assert_eq!(ix.program_id, custom);
    });
}

#[test]
#[serial]
fn larger_instruction_builder_also_tracks_selector() {
    // Touches a more elaborate builder (11 accounts, args struct) to make
    // sure the selector wiring isn't only working for the small variant.
    let accounts = InitializePool {
        whirlpools_config: whirlpools_config(),
        token_mint_a: token_mint_a(),
        token_mint_b: token_mint_b(),
        funder: Pubkey::new_unique(),
        whirlpool: Pubkey::new_unique(),
        token_vault_a: Pubkey::new_unique(),
        token_vault_b: Pubkey::new_unique(),
        fee_tier: Pubkey::new_unique(),
        token_program: Pubkey::new_unique(),
        system_program: Pubkey::new_unique(),
        rent: Pubkey::new_unique(),
    };
    let args = InitializePoolInstructionArgs {
        whirlpool_bump: 254,
        tick_spacing: 64,
        initial_sqrt_price: 1u128 << 64,
    };

    with_program(WhirlpoolProgram::Immutable, || {
        let ix = accounts.instruction(args.clone());
        assert_eq!(ix.program_id, WHIRLPOOL_IMMUTABLE_ID);
    });

    with_program(WhirlpoolProgram::Mutable, || {
        let ix = accounts.instruction(args.clone());
        assert_eq!(ix.program_id, WHIRLPOOL_ID);
    });
}

#[test]
#[serial]
fn current_whirlpool_id_observes_changes_immediately() {
    let baseline = current_whirlpool_id();

    set_whirlpool_program_raw(WhirlpoolProgram::Immutable);
    assert_eq!(current_whirlpool_id(), WHIRLPOOL_IMMUTABLE_ID);

    let custom = Pubkey::new_unique();
    set_whirlpool_program_raw(WhirlpoolProgram::Address(custom));
    assert_eq!(current_whirlpool_id(), custom);

    set_whirlpool_program_raw(WhirlpoolProgram::Address(baseline));
    assert_eq!(current_whirlpool_id(), baseline);
}
