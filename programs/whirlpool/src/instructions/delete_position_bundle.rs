use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::state::*;
use crate::util::burn_and_close_position_bundle_token;

#[derive(Accounts)]
pub struct DeletePositionBundle<'info> {
    #[account(mut, close = receiver)]
    pub position_bundle: Account<'info, PositionBundle>,

    #[account(mut, address = position_bundle.position_bundle_mint)]
    pub position_bundle_mint: Account<'info, Mint>,

    #[account(mut,
        constraint = position_bundle_token_account.mint == position_bundle.position_bundle_mint,
        constraint = position_bundle_token_account.owner == position_bundle_owner.key(),
        constraint = position_bundle_token_account.amount == 1,
    )]
    pub position_bundle_token_account: Box<Account<'info, TokenAccount>>,

    pub position_bundle_owner: Signer<'info>,

    /// CHECK: safe, for receiving rent only
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DeletePositionBundle>) -> Result<()> {
    let position_bundle = &ctx.accounts.position_bundle;

    if !position_bundle.is_deletable() {
        return Err(ErrorCode::PositionBundleNotDeletable.into());
    }

    burn_and_close_position_bundle_token(
        &ctx.accounts.position_bundle_owner,
        &ctx.accounts.receiver,
        &ctx.accounts.position_bundle_mint,
        &ctx.accounts.position_bundle_token_account,
        &ctx.accounts.token_program,
    )
}
