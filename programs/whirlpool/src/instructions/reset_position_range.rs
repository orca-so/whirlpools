use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount as TokenAccountInterface;

use crate::state::*;
use crate::util::verify_position_authority_interface;

#[derive(Accounts)]
pub struct ResetPositionRange<'info> {
    // Maybe used in the future
    #[account(mut)]
    pub funder: Signer<'info>,

    pub position_authority: Signer<'info>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    // Constraint checked via verify_position_authority
    #[account(mut, has_one = whirlpool)]
    pub position: Box<Account<'info, Position>>,

    #[account(mut,
        constraint = position_token_account.amount == 1,
        constraint = position_token_account.mint == position.position_mint)]
    pub position_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    // Maybe used in the future
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ResetPositionRange>,
    new_tick_lower_index: i32,
    new_tick_upper_index: i32,
) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    ctx.accounts.position.reset_position_range(
        &ctx.accounts.whirlpool,
        new_tick_lower_index,
        new_tick_upper_index,
    )
}
