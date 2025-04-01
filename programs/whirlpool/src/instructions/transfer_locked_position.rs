use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{self, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    state::*,
    util::{
        close_empty_token_account_2022, freeze_user_position_token_2022, is_locked_position,
        transfer_user_position_token_2022, unfreeze_user_position_token_2022, validate_owner,
    },
};

#[derive(Accounts)]
pub struct TransferLockedPosition<'info> {
    pub position_authority: Signer<'info>,

    #[account(
        seeds = [b"position".as_ref(), position_mint.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(address = position.position_mint)]
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
      has_one = position
    )]
    pub lock_config: Box<Account<'info, LockConfig>>,

    #[account(address = token_2022::ID)]
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<TransferLockedPosition>) -> Result<()> {
    // Only allow the owner of the position to transfer this and not the delegate.
    // * Once a position is locked the delegate cannot be changed
    // * The delegate gets removed once it transfers the position, meaning the freeze ix fails here
    validate_owner(
        &ctx.accounts.position_token_account.owner,
        &ctx.accounts.position_authority.to_account_info(),
    )?;

    if !is_locked_position(&ctx.accounts.position_token_account) {
        unreachable!("Position has to be locked for this instruction");
    }

    unfreeze_user_position_token_2022(
        &ctx.accounts.position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.token_2022_program,
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
        &ctx.accounts.token_2022_program,
    )?;

    freeze_user_position_token_2022(
        &ctx.accounts.position_mint,
        &ctx.accounts.destination_token_account,
        &ctx.accounts.token_2022_program,
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
        &ctx.accounts.token_2022_program,
        &ctx.accounts.position_authority,
    )?;

    ctx.accounts
        .lock_config
        .update_position_owner(ctx.accounts.destination_token_account.owner);

    Ok(())
}
