use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{state::*, util::verify_position_bundle_authority};

#[derive(Accounts)]
#[instruction(bundle_index: u16)]
pub struct OpenBundledPosition<'info> {
    #[account(init,
        payer = funder,
        space = Position::LEN,
        seeds = [
            b"position".as_ref(),
            position_bundle.position_bundle_mint.key().as_ref(),
            bundle_index.to_string().as_bytes()
        ],
        bump,
    )]
    pub bundled_position: Box<Account<'info, Position>>,

    #[account(mut)]
    pub position_bundle: Box<Account<'info, PositionBundle>>,

    #[account(
        constraint = position_bundle_token_account.mint == position_bundle.position_bundle_mint,
        constraint = position_bundle_token_account.amount == 1
    )]
    pub position_bundle_token_account: Box<Account<'info, TokenAccount>>,

    pub position_bundle_authority: Signer<'info>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<OpenBundledPosition>,
    bundle_index: u16,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    let whirlpool = &ctx.accounts.whirlpool;
    let position_bundle = &mut ctx.accounts.position_bundle;
    let position = &mut ctx.accounts.bundled_position;

    // Allow delegation
    verify_position_bundle_authority(
        &ctx.accounts.position_bundle_token_account,
        &ctx.accounts.position_bundle_authority,
    )?;

    position_bundle.open_bundled_position(bundle_index)?;

    position.open_position(
        whirlpool,
        position_bundle.position_bundle_mint,
        tick_lower_index,
        tick_upper_index,
    )?;

    Ok(())
}
