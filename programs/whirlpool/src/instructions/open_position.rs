use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::state;
use crate::{state::*, util::mint_position_token_and_remove_authority};

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: safe, the account that will be the owner of the position can be arbitrary
    pub owner: UncheckedAccount<'info>,

    #[account(init,
      payer = funder,
      space = Position::LEN,
      seeds = [b"position".as_ref(), position_mint.key().as_ref()],
      bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(init,
        payer = funder,
        mint::authority = whirlpool,
        mint::decimals = 0,
    )]
    pub position_mint: Account<'info, Mint>,

    #[account(init,
      payer = funder,
      associated_token::mint = position_mint,
      associated_token::authority = owner,
    )]
    pub position_token_account: Box<Account<'info, TokenAccount>>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: no longer used anywhere
    pub rent: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/*
  Opens a new Whirlpool Position.
*/
pub fn handler(
    ctx: Context<OpenPosition>,
    // derive(Accounts) generates OpenPositionBumps, so we need to clarify which one we want to use.
    _bumps: state::OpenPositionBumps,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    let whirlpool = &ctx.accounts.whirlpool;
    let position_mint = &ctx.accounts.position_mint;
    let position = &mut ctx.accounts.position;

    position.open_position(
        whirlpool,
        position_mint.key(),
        tick_lower_index,
        tick_upper_index,
    )?;

    mint_position_token_and_remove_authority(
        whirlpool,
        position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.token_program,
    )
}
