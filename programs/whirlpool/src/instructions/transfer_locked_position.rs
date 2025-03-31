use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    state::*,
    util::{
        close_empty_token_account_2022, freeze_user_position_token_2022, is_locked_position,
        transfer_user_position_token_2022, unfreeze_user_position_token_2022,
        verify_position_authority_interface,
    },
};

use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct TransferLockedPosition<'info> {
    pub position_authority: Signer<'info>,

    #[account(
        seeds = [b"position".as_ref(), position_mint.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(address = position.position_mint, owner = token_program.key())]
    pub position_mint: InterfaceAccount<'info, Mint>,

    #[account(mut,
        constraint = position_token_account.amount == 1,
        constraint = position_token_account.mint == position.position_mint,
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut,
      constraint = destination_token_account.mint == position.position_mint,
      constraint = destination_token_account.key() != position_token_account.key(),
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
      mut,
      seeds = [b"lock_config".as_ref(), position.key().as_ref()],
      bump,
    )]
    pub lock_config: Box<Account<'info, LockConfig>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<TransferLockedPosition>) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    if !is_locked_position(&ctx.accounts.position_token_account) {
        return Err(ErrorCode::OperationNotAllowedOnUnlockedPosition.into());
    }

    unfreeze_user_position_token_2022(
        &ctx.accounts.position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.token_program,
        &ctx.accounts.position,
        &[
            b"position".as_ref(),
            ctx.accounts.position_mint.key().as_ref(),
            &[ctx.bumps.position],
        ],
    )?;

    transfer_user_position_token_2022(
        &ctx.accounts.position_authority,
        &ctx.accounts.position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.destination_token_account,
        &ctx.accounts.token_program,
    )?;

    freeze_user_position_token_2022(
        &ctx.accounts.position_mint,
        &ctx.accounts.destination_token_account,
        &ctx.accounts.token_program,
        &ctx.accounts.position,
        &[
            b"position".as_ref(),
            ctx.accounts.position_mint.key().as_ref(),
            &[ctx.bumps.position],
        ],
    )?;

    close_empty_token_account_2022(
        &ctx.accounts.position_authority,
        &ctx.accounts.position_token_account,
        &ctx.accounts.token_program,
        &ctx.accounts.position_authority,
    )?;

    ctx.accounts.lock_config.position_owner = ctx.accounts.destination_token_account.owner;

    Ok(())
}
