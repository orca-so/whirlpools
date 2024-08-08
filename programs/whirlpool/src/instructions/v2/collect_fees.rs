use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::util::{parse_remaining_accounts, AccountsType, RemainingAccountsInfo};
use crate::{
    constants::transfer_memo,
    state::*,
    util::{v2::transfer_from_vault_to_owner_v2, verify_position_authority},
};

#[derive(Accounts)]
pub struct CollectFeesV2<'info> {
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    pub position_authority: Signer<'info>,

    #[account(mut, has_one = whirlpool)]
    pub position: Box<Account<'info, Position>>,
    #[account(
        constraint = position_token_account.mint == position.position_mint,
        constraint = position_token_account.amount == 1
    )]
    pub position_token_account: Box<Account<'info, token::TokenAccount>>,

    #[account(address = whirlpool.token_mint_a)]
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool.token_mint_b)]
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_a)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_b)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(constraint = token_program_a.key() == *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(constraint = token_program_b.key() == *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,
    pub memo_program: Program<'info, Memo>,
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CollectFeesV2<'info>>,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
) -> Result<()> {
    verify_position_authority(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        ctx.remaining_accounts,
        &remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    let position = &mut ctx.accounts.position;

    // Store the fees owed to use as transfer amounts.
    let fee_owed_a = position.fee_owed_a;
    let fee_owed_b = position.fee_owed_b;

    position.reset_fees_owed();

    transfer_from_vault_to_owner_v2(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_program_a,
        &ctx.accounts.memo_program,
        &remaining_accounts.transfer_hook_a,
        fee_owed_a,
        transfer_memo::TRANSFER_MEMO_COLLECT_FEES.as_bytes(),
    )?;

    transfer_from_vault_to_owner_v2(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_program_b,
        &ctx.accounts.memo_program,
        &remaining_accounts.transfer_hook_b,
        fee_owed_b,
        transfer_memo::TRANSFER_MEMO_COLLECT_FEES.as_bytes(),
    )?;

    Ok(())
}
