use solana_sdk::{pubkey::Pubkey, signer::Signer, system_program};
use std::error::Error;

use orca_whirlpools_client::{
    get_fee_tier_address, get_token_badge_address, get_whirlpool_address,
    InitializePoolV2, InitializePoolV2InstructionArgs,
};
use orca_whirlpools_core::{price_to_sqrt_price, tick_index_to_sqrt_price};
use solana_program::sysvar::rent::ID as RENT_PROGRAM_ID;

use crate::WHIRLPOOLS_CONFIG_ADDRESS;

use super::rpc::RpcContext;

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

    let instructions = vec![
        InitializePoolV2 {
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
        }),
    ];

    ctx.send_transaction_with_signers(instructions, vec![&vault_a, &vault_b])
        .await?;

    Ok(whirlpool)
}

pub async fn setup_position(_whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}

pub async fn setup_te_position(_whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}

pub async fn setup_position_bundle(_whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}
