use crate::{state::*, util::transfer_from_vault_to_owner};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

#[derive(Accounts)]
pub struct CollectProtocolFeesV2<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(mut, has_one = whirlpools_config)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(address = whirlpools_config.collect_protocol_fees_authority)]
    pub collect_protocol_fees_authority: Signer<'info>,

    #[account(address = whirlpool.token_mint_a)]
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool.token_mint_b)]
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut, address = whirlpool.token_vault_a)]
    pub token_vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, address = whirlpool.token_vault_b)]
    pub token_vault_b: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = token_destination_a.mint == whirlpool.token_mint_a)]
    pub token_destination_a: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = token_destination_b.mint == whirlpool.token_mint_b)]
    pub token_destination_b: InterfaceAccount<'info, TokenAccount>,

    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
    pub memo_program: Program<'info, Memo>,
}

pub fn handler(ctx: Context<CollectProtocolFeesV2>) -> Result<()> {
    let whirlpool = &ctx.accounts.whirlpool;

    transfer_from_vault_to_owner(
        whirlpool,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_destination_a,
        &ctx.accounts.token_program,
        whirlpool.protocol_fee_owed_a,
    )?;

    transfer_from_vault_to_owner(
        whirlpool,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_destination_b,
        &ctx.accounts.token_program,
        whirlpool.protocol_fee_owed_b,
    )?;

    Ok(ctx.accounts.whirlpool.reset_protocol_fees_owed())
}
