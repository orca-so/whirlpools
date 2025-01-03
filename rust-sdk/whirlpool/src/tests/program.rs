use orca_whirlpools_client::{
    get_bundled_position_address, get_fee_tier_address, get_position_address,
    get_position_bundle_address, get_token_badge_address, get_whirlpool_address, InitializePoolV2,
    InitializePoolV2InstructionArgs, InitializePositionBundle, OpenBundledPosition,
    OpenBundledPositionInstructionArgs, OpenPosition, OpenPositionInstructionArgs,
};
use orca_whirlpools_core::tick_index_to_sqrt_price;
use solana_program::program_pack::Pack;
use solana_program::sysvar::rent::ID as RENT_PROGRAM_ID;
use solana_sdk::{
    pubkey::Pubkey,
    signer::{keypair::Keypair, Signer},
    system_instruction, system_program,
};
use spl_associated_token_account::{
    get_associated_token_address, get_associated_token_address_with_program_id,
    instruction::create_associated_token_account,
};
use spl_token::{state::Mint, ID as TOKEN_PROGRAM_ID};
use spl_token_2022::{state::Mint as Token2022Mint, ID as TOKEN_2022_PROGRAM_ID};
use std::error::Error;

use crate::WHIRLPOOLS_CONFIG_ADDRESS;

use super::rpc::RpcContext;

use crate::tests::token::{setup_ata, setup_mint_with_decimals};
use crate::tests::token_extensions::setup_mint_te;

pub async fn setup_whirlpool(
    ctx: &RpcContext,
    token_a: Pubkey,
    token_b: Pubkey,
    tick_spacing: u16,
) -> Result<Pubkey, Box<dyn Error>> {
    let config = *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?;
    let fee_tier = get_fee_tier_address(&config, tick_spacing)?.0;
    let whirlpool = get_whirlpool_address(&config, &token_a, &token_b, tick_spacing)?.0;
    let token_badge_a = get_token_badge_address(&config, &token_a)?.0;
    let token_badge_b = get_token_badge_address(&config, &token_b)?.0;

    let vault_a = ctx.get_next_keypair();
    let vault_b = ctx.get_next_keypair();

    let mint_a_info = ctx.rpc.get_account(&token_a).await?;
    let mint_b_info = ctx.rpc.get_account(&token_b).await?;

    // Default initial price of 1.0
    let sqrt_price = tick_index_to_sqrt_price(0);

    let instructions = vec![InitializePoolV2 {
        whirlpool,
        fee_tier,
        token_mint_a: token_a,
        token_mint_b: token_b,
        whirlpools_config: config,
        funder: ctx.signer.pubkey(),
        token_vault_a: vault_a.pubkey(),
        token_vault_b: vault_b.pubkey(),
        token_badge_a,
        token_badge_b,
        token_program_a: mint_a_info.owner,
        token_program_b: mint_b_info.owner,
        system_program: system_program::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction(InitializePoolV2InstructionArgs {
        tick_spacing,
        initial_sqrt_price: sqrt_price,
    })];

    ctx.send_transaction_with_signers(instructions, vec![&vault_a, &vault_b])
        .await?;

    Ok(whirlpool)
}

pub async fn setup_position(whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    let ctx = RpcContext::new().await;

    // Use token utility functions
    let position_mint = setup_mint_with_decimals(&ctx, 0).await?;
    let position_token_account = setup_ata(&ctx, position_mint).await?;

    let (position_pubkey, position_bump) = get_position_address(&position_mint)?;

    let open_position_ix = OpenPosition {
        funder: ctx.signer.pubkey(),
        owner: ctx.signer.pubkey(),
        position: position_pubkey,
        position_mint,
        position_token_account,
        whirlpool,
        token_program: TOKEN_PROGRAM_ID,
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction(OpenPositionInstructionArgs {
        tick_lower_index: -128,
        tick_upper_index: 128,
        position_bump,
    });

    ctx.send_transaction(vec![open_position_ix]).await?;

    Ok(position_pubkey)
}

pub async fn setup_te_position(whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    let ctx = RpcContext::new().await;

    let position_mint = Keypair::new();
    let lamports = ctx
        .rpc
        .get_minimum_balance_for_rent_exemption(Token2022Mint::LEN)
        .await?;

    let create_mint_ix = system_instruction::create_account(
        &ctx.signer.pubkey(),
        &position_mint.pubkey(),
        lamports,
        Token2022Mint::LEN as u64,
        &TOKEN_2022_PROGRAM_ID,
    );

    let init_mint_ix = spl_token_2022::instruction::initialize_mint(
        &TOKEN_2022_PROGRAM_ID,
        &position_mint.pubkey(),
        &ctx.signer.pubkey(),
        None,
        0,
    )?;

    let position_token_account =
        get_associated_token_address(&ctx.signer.pubkey(), &position_mint.pubkey());

    let create_ata_ix = create_associated_token_account(
        &ctx.signer.pubkey(),
        &ctx.signer.pubkey(),
        &position_mint.pubkey(),
        &TOKEN_2022_PROGRAM_ID,
    );

    let (position_pubkey, position_bump) = get_position_address(&position_mint.pubkey())?;

    let tick_lower_index: i32 = -128;
    let tick_upper_index: i32 = 128;

    let open_position_ix = OpenPosition {
        funder: ctx.signer.pubkey(),
        owner: ctx.signer.pubkey(),
        position: position_pubkey,
        position_mint: position_mint.pubkey(),
        position_token_account,
        whirlpool,
        token_program: TOKEN_2022_PROGRAM_ID,
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction(OpenPositionInstructionArgs {
        tick_lower_index,
        tick_upper_index,
        position_bump,
    });

    ctx.send_transaction_with_signers(
        vec![
            create_mint_ix,
            init_mint_ix,
            create_ata_ix,
            open_position_ix,
        ],
        vec![&position_mint],
    )
    .await?;

    Ok(position_pubkey)
}

/// Creates a Position Bundle and initializes the specified number of bundled positions
/// Calls `OpenBundledPosition` for each position specified in `bundle_positions`
pub async fn setup_position_bundle(
    whirlpool: Pubkey,
    bundle_positions: Option<Vec<()>>,
) -> Result<Pubkey, Box<dyn Error>> {
    let ctx = RpcContext::new().await;

    // Use token utility functions
    let position_bundle_mint = setup_mint_with_decimals(&ctx, 0).await?;
    let position_bundle_token_account = setup_ata(&ctx, position_bundle_mint).await?;

    let (position_bundle_address, _) = get_position_bundle_address(&position_bundle_mint)?;

    let open_bundle_ix = InitializePositionBundle {
        funder: ctx.signer.pubkey(),
        position_bundle: position_bundle_address,
        position_bundle_mint,
        position_bundle_token_account,
        position_bundle_owner: ctx.signer.pubkey(),
        token_program: TOKEN_PROGRAM_ID,
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction();

    ctx.send_transaction(vec![open_bundle_ix]).await?;

    // Initialize bundled positions
    if let Some(positions) = bundle_positions {
        for (i, _) in positions.iter().enumerate() {
            let bundle_index = i as u16;
            let (bundled_position_address, _) =
                get_bundled_position_address(&position_bundle_mint, bundle_index as u8)?;

            let open_bundled_ix = OpenBundledPosition {
                funder: ctx.signer.pubkey(),
                bundled_position: bundled_position_address,
                position_bundle: position_bundle_address,
                position_bundle_authority: ctx.signer.pubkey(),
                position_bundle_token_account,
                whirlpool,
                system_program: system_program::id(),
                rent: RENT_PROGRAM_ID,
            }
            .instruction(OpenBundledPositionInstructionArgs {
                tick_lower_index: -128,
                tick_upper_index: 128,
                bundle_index,
            });

            ctx.send_transaction(vec![open_bundled_ix]).await?;
        }
    }

    Ok(position_bundle_address)
}
