use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::ErrorCode;
use crate::state::*;
use crate::util::{
    burn_and_close_user_position_token_2022, is_locked_position,
    verify_position_authority_interface,
};

#[derive(Accounts)]
pub struct ClosePositionWithTokenExtensions<'info> {
    pub position_authority: Signer<'info>,

    /// CHECK: safe, for receiving rent only
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,

    #[account(mut,
        close = receiver,
        seeds = [b"position".as_ref(), position_mint.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = position.position_mint, owner = token_2022_program.key())]
    pub position_mint: InterfaceAccount<'info, Mint>,

    #[account(mut,
        constraint = position_token_account.amount == 1,
        constraint = position_token_account.mint == position.position_mint
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = token_2022::ID)]
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<ClosePositionWithTokenExtensions>) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    if is_locked_position(&ctx.accounts.position_token_account) {
        return Err(ErrorCode::OperationNotAllowedOnLockedPosition.into());
    }

    if !Position::is_position_empty(&ctx.accounts.position) {
        return Err(ErrorCode::ClosePositionNotEmpty.into());
    }

    burn_and_close_user_position_token_2022(
        &ctx.accounts.position_authority,
        &ctx.accounts.receiver,
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

    Ok(())
}
