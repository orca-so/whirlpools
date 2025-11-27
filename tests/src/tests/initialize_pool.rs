use crate::constants::{RENT_PUBKEY, SYSTEM_PROGRAM_ID};
use crate::helper::{advance_clock, init_svm, load_keypair_from_fixture};
use crate::instructions::initialize_config_ix::InitializeConfigIxBuilder;
use crate::instructions::initialize_fee_tier_ix::InitializeFeeTierIxBuilder;
use crate::instructions::initialize_pool_ix::InitializePoolIxBuilder;
use crate::instructions::initialize_pool_step_1_ix::InitializePoolStep1IxBuilder;
use crate::instructions::BaseBuilderTrait;
use crate::pda::whirlpool;
use crate::spl::setup_mint_account;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use spl_token::ID as TOKEN_PROGRAM_ID;

/*
=== tests created ===

* optimization_test: current state
* optimization_step_1_test: after optimization
*/

fn setup_test() -> (
    LiteSVM,
    Keypair,
    Keypair,
    Pubkey,
    Pubkey,
    Pubkey,
    Pubkey,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Pubkey,
) {
    let admin = load_keypair_from_fixture("admin");
    let funder = load_keypair_from_fixture("funder");
    let token_vault_a = load_keypair_from_fixture("token_vault_a");
    let token_vault_b = load_keypair_from_fixture("token_vault_b");
    let token_vault_c = load_keypair_from_fixture("token_vault_c");
    let token_vault_d = load_keypair_from_fixture("token_vault_d");
    let whirlpools_config = load_keypair_from_fixture("config");
    let token_mint_a_keypair = load_keypair_from_fixture("token_mint_a");
    let token_mint_b_keypair = load_keypair_from_fixture("token_mint_b");
    let token_mint_c_keypair = load_keypair_from_fixture("token_mint_c");
    let token_mint_d_keypair = load_keypair_from_fixture("token_mint_d");

    let mut svm = init_svm(&[&admin, &funder]);

    // instanciate token mints
    let token_mint_a = token_mint_a_keypair.pubkey();
    let token_mint_b = token_mint_b_keypair.pubkey();
    let token_mint_c = token_mint_c_keypair.pubkey();
    let token_mint_d = token_mint_d_keypair.pubkey();
    setup_mint_account(&mut svm, &token_mint_a, &admin.pubkey(), 1000000000, 6);
    setup_mint_account(&mut svm, &token_mint_b, &admin.pubkey(), 1000000000, 6);
    setup_mint_account(&mut svm, &token_mint_c, &admin.pubkey(), 1000000000, 6);
    setup_mint_account(&mut svm, &token_mint_d, &admin.pubkey(), 1000000000, 6);

    // instanciate whirlpools config
    InitializeConfigIxBuilder::new(&mut svm, &admin, &whirlpools_config)
        .run()
        .ok();

    // instanciate fee tier
    InitializeFeeTierIxBuilder::new(&mut svm, &admin, whirlpools_config.pubkey(), 100, 1000)
        .run()
        .ok();

    (
        svm,
        admin,
        funder,
        token_mint_a,
        token_mint_b,
        token_mint_c,
        token_mint_d,
        token_vault_a,
        token_vault_b,
        token_vault_c,
        token_vault_d,
        whirlpools_config.pubkey(),
    )
}

#[test]
fn optimization_test() {
    let (
        mut svm,
        admin,
        funder,
        token_mint_a,
        token_mint_b,
        token_mint_c,
        token_mint_d,
        token_vault_a,
        token_vault_b,
        token_vault_c,
        token_vault_d,
        whirlpools_config,
    ) = setup_test();

    // warm up
    InitializePoolIxBuilder::new(
        &mut svm,
        &admin,
        whirlpools_config,
        token_mint_a,
        token_mint_b,
        &funder,
        &token_vault_a,
        &token_vault_b,
        TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
        RENT_PUBKEY,
        100,
        18446744073709551616, // price = 1
    )
    .run(0u8)
    .ok();

    advance_clock(&mut svm, 1000);

    let compute_units = InitializePoolIxBuilder::new(
        &mut svm,
        &admin,
        whirlpools_config,
        token_mint_c,
        token_mint_d,
        &funder,
        &token_vault_c,
        &token_vault_d,
        TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
        RENT_PUBKEY,
        100,
        18446744073709551616, // price = 1
    )
    .run(1u8)
    .ok()
    .get_compute_units();

    println!("Compute units step 0: {}", compute_units);
}

#[test]
fn optimization_step_1_test() {
    let (
        mut svm,
        admin,
        funder,
        token_mint_a,
        token_mint_b,
        token_mint_c,
        token_mint_d,
        token_vault_a,
        token_vault_b,
        token_vault_c,
        token_vault_d,
        whirlpools_config,
    ) = setup_test();

    // warm up
    InitializePoolStep1IxBuilder::new(
        &mut svm,
        &admin,
        whirlpools_config,
        token_mint_a,
        token_mint_b,
        &funder,
        &token_vault_a,
        &token_vault_b,
        TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
        RENT_PUBKEY,
        100,
        18446744073709551616, // price = 1
    )
    .run(0u8)
    .ok();

    advance_clock(&mut svm, 1000);

    let compute_units = InitializePoolStep1IxBuilder::new(
        &mut svm,
        &admin,
        whirlpools_config,
        token_mint_c,
        token_mint_d,
        &funder,
        &token_vault_c,
        &token_vault_d,
        TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
        RENT_PUBKEY,
        100,
        18446744073709551616, // price = 1
    )
    .run(1u8)
    .ok()
    .display_logs()
    .get_compute_units();

    println!("Compute units step 1: {}", compute_units);
}
