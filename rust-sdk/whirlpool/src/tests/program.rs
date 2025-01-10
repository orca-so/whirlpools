use orca_whirlpools_client::{
    get_bundled_position_address, get_fee_tier_address, get_position_address,
    get_position_bundle_address, get_tick_array_address, get_token_badge_address,
    get_whirlpool_address, InitializePoolV2, InitializePoolV2InstructionArgs,
    InitializePositionBundle, InitializeTickArray, InitializeTickArrayInstructionArgs,
    OpenBundledPosition, OpenBundledPositionInstructionArgs, OpenPosition,
    OpenPositionInstructionArgs, Whirlpool,
};
use orca_whirlpools_core::{
    get_initializable_tick_index, get_tick_array_start_tick_index, tick_index_to_sqrt_price,
};
use solana_program::program_pack::Pack;
use solana_program::sysvar::rent::ID as RENT_PROGRAM_ID;
use solana_sdk::{
    pubkey::Pubkey,
    signer::{keypair::Keypair, Signer},
    system_instruction, system_program,
};
use spl_associated_token_account::{
    get_associated_token_address, instruction::create_associated_token_account,
};
use spl_token::instruction::initialize_mint2;
use spl_token::ID as TOKEN_PROGRAM_ID;
use spl_token_2022::{state::Mint as Token2022Mint, ID as TOKEN_2022_PROGRAM_ID};
use std::error::Error;

use crate::tests::token::{setup_ata, setup_mint_with_decimals};
use crate::WHIRLPOOLS_CONFIG_ADDRESS;

use super::rpc::RpcContext;

use crate::tests::token_extensions::setup_mint_te;

use solana_program::system_instruction::create_account;
use spl_token::state::Mint;

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

pub async fn setup_position(
    ctx: &RpcContext,
    whirlpool: Pubkey,
    tick_range: Option<(i32, i32)>,
    owner: Option<Pubkey>,
) -> Result<Pubkey, Box<dyn Error>> {
    let owner = owner.unwrap_or_else(|| ctx.signer.pubkey());
    let whirlpool_data = ctx.rpc.get_account(&whirlpool).await?;
    let whirlpool_account = Whirlpool::from_bytes(&whirlpool_data.data)?;

    let (tick_lower, tick_upper) = tick_range.unwrap_or((-100, 100));

    let lower_tick_index = get_initializable_tick_index(
        tick_lower - (tick_lower % whirlpool_account.tick_spacing as i32),
        whirlpool_account.tick_spacing,
        None,
    );
    let upper_tick_index = get_initializable_tick_index(
        tick_upper - (tick_upper % whirlpool_account.tick_spacing as i32),
        whirlpool_account.tick_spacing,
        None,
    );

    let position_mint = ctx.get_next_keypair();

    let (position_pubkey, position_bump) = get_position_address(&position_mint.pubkey())?;

    // Create position mint
    let position_mint = Keypair::new();

    // Calculate position PDA
    let (position_pubkey, position_bump) = get_position_address(&position_mint.pubkey())?;

    // Calculate position token account
    let position_token_account = get_associated_token_address(&owner, &position_mint.pubkey());

    // Create OpenPosition instruction
    let open_position_ix = OpenPosition {
        funder: ctx.signer.pubkey(),
        owner: owner,
        position: position_pubkey,
        position_mint: position_mint.pubkey(),
        position_token_account: Pubkey::default(), // instruction will create
        whirlpool,
        token_program: TOKEN_PROGRAM_ID, // or TOKEN_2022_PROGRAM_ID if needed
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction(OpenPositionInstructionArgs {
        tick_lower_index: lower_tick_index,
        tick_upper_index: upper_tick_index,
        position_bump,
    });

    ctx.send_transaction_with_signers(vec![open_position_ix], vec![&position_mint])
        .await?;

    Ok(position_mint.pubkey())
}
pub async fn setup_te_position(
    ctx: &RpcContext,
    whirlpool: Pubkey,
    tick_range: Option<(i32, i32)>,
    owner: Option<Pubkey>,
) -> Result<Pubkey, Box<dyn Error>> {
    let owner = owner.unwrap_or_else(|| ctx.signer.pubkey());
    let whirlpool_data = ctx.rpc.get_account(&whirlpool).await?;
    let whirlpool_account = Whirlpool::from_bytes(&whirlpool_data.data)?;

    // Get tick range
    let (tick_lower, tick_upper) = tick_range.unwrap_or((-100, 100));

    // Get initializable tick indexes
    let lower_tick_index =
        get_initializable_tick_index(tick_lower, whirlpool_account.tick_spacing, None);
    let upper_tick_index =
        get_initializable_tick_index(tick_upper, whirlpool_account.tick_spacing, None);

    let tick_arrays = [
        get_tick_array_start_tick_index(lower_tick_index, whirlpool_account.tick_spacing),
        get_tick_array_start_tick_index(upper_tick_index, whirlpool_account.tick_spacing),
    ];

    for start_tick in tick_arrays.iter() {
        let (tick_array_address, _) = get_tick_array_address(&whirlpool, *start_tick)?;

        let account_result = ctx.rpc.get_account(&tick_array_address).await;
        let needs_init = match account_result {
            Ok(account) => account.data.is_empty(),
            Err(_) => true,
        };

        if needs_init {
            let init_tick_array_ix = InitializeTickArray {
                whirlpool,
                funder: ctx.signer.pubkey(),
                tick_array: tick_array_address,
                system_program: system_program::id(),
            }
            .instruction(InitializeTickArrayInstructionArgs {
                start_tick_index: *start_tick,
            });

            ctx.send_transaction(vec![init_tick_array_ix]).await?;
        }
    }

    // 1) Keypair for the TE position mint
    let te_position_mint = ctx.get_next_keypair();

    // 2) Derive the position PDA
    let (position_pubkey, position_bump) = get_position_address(&te_position_mint.pubkey())?;

    // 3) Build an OpenPosition instruction with token_program = TOKEN_2022_PROGRAM_ID
    let open_position_ix = OpenPosition {
        funder: ctx.signer.pubkey(),
        owner: owner,
        position: position_pubkey,
        position_mint: te_position_mint.pubkey(),
        position_token_account: Pubkey::default(),
        whirlpool,
        token_program: TOKEN_2022_PROGRAM_ID, // TE uses token-2022
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction(OpenPositionInstructionArgs {
        tick_lower_index: -128,
        tick_upper_index: 128,
        position_bump,
    });

    // 4) The instruction itself will create the mint & ATA
    ctx.send_transaction_with_signers(vec![open_position_ix], vec![&te_position_mint])
        .await?;

    // 5) Return the position PDA
    Ok(position_pubkey)
}

pub async fn setup_position_bundle(
    whirlpool: Pubkey,
    bundle_positions: Option<Vec<()>>,
) -> Result<Pubkey, Box<dyn Error>> {
    let ctx = RpcContext::new().await;

    let position_bundle_mint = ctx.get_next_keypair();
    let (position_bundle_address, _bundle_bump) =
        get_position_bundle_address(&position_bundle_mint.pubkey())?;

    let open_bundle_ix = InitializePositionBundle {
        funder: ctx.signer.pubkey(),
        position_bundle: position_bundle_address,
        position_bundle_mint: position_bundle_mint.pubkey(),
        position_bundle_token_account: Pubkey::default(),
        position_bundle_owner: ctx.signer.pubkey(),
        token_program: TOKEN_PROGRAM_ID,
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction();

    ctx.send_transaction_with_signers(vec![open_bundle_ix], vec![&position_bundle_mint])
        .await?;

    if let Some(positions) = bundle_positions {
        for (i, _) in positions.iter().enumerate() {
            let bundle_index = i as u16;
            let (bundled_position_address, _) =
                get_bundled_position_address(&position_bundle_mint.pubkey(), bundle_index as u8)?;

            let open_bundled_ix = OpenBundledPosition {
                funder: ctx.signer.pubkey(),
                bundled_position: bundled_position_address,
                position_bundle: position_bundle_address,
                position_bundle_authority: ctx.signer.pubkey(),
                position_bundle_token_account: Pubkey::default(),
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
