use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::ErrorCode;
use crate::{state::*, util::verify_position_bundle_authority};

#[derive(Accounts)]
#[instruction(bundle_index: u16)]
pub struct CloseBundledPosition<'info> {
    #[account(mut,
        close = receiver,
        seeds = [
            b"bundled_position".as_ref(),
            position_bundle.position_bundle_mint.key().as_ref(),
            bundle_index.to_string().as_bytes()
        ],
        bump,
    )]
    pub bundled_position: Account<'info, Position>,

    #[account(mut)]
    pub position_bundle: Box<Account<'info, PositionBundle>>,

    #[account(
        constraint = position_bundle_token_account.mint == bundled_position.position_mint,
        constraint = position_bundle_token_account.mint == position_bundle.position_bundle_mint,
        constraint = position_bundle_token_account.amount == 1
    )]
    pub position_bundle_token_account: Box<Account<'info, TokenAccount>>,

    pub position_bundle_authority: Signer<'info>,

    /// CHECK: safe, for receiving rent only
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CloseBundledPosition>, bundle_index: u16) -> Result<()> {
    let position_bundle = &mut ctx.accounts.position_bundle;

    // Allow delegation
    verify_position_bundle_authority(
        &ctx.accounts.position_bundle_token_account,
        &ctx.accounts.position_bundle_authority,
    )?;

    if !Position::is_position_empty(&ctx.accounts.bundled_position) {
        return Err(ErrorCode::ClosePositionNotEmpty.into());
    }

    position_bundle.close_bundled_position(bundle_index)?;

    // Anchor will close the Position account

    Ok(())
}
