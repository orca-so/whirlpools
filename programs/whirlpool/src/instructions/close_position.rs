use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::state::*;
use crate::util::{burn_and_close_user_position_token, verify_position_authority};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
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

    #[account(mut, address = position.position_mint)]
    pub position_mint: Account<'info, Mint>,

    #[account(mut,
        constraint = position_token_account.amount == 1,
        constraint = position_token_account.mint == position.position_mint)]
    pub position_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClosePosition>) -> Result<()> {
    verify_position_authority(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    if !Position::is_position_empty(&ctx.accounts.position) {
        return Err(ErrorCode::ClosePositionNotEmpty.into());
    }

    burn_and_close_user_position_token(
        &ctx.accounts.position_authority,
        &ctx.accounts.receiver,
        &ctx.accounts.position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.token_program,
    )
}
