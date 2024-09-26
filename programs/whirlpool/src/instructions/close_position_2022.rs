use anchor_lang::prelude::*;
//use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};
use solana_program::program::{invoke, invoke_signed};
use anchor_spl::token_2022::spl_token_2022;

use crate::errors::ErrorCode;
use crate::state::*;
use crate::util::verify_position_authority_interface;

#[derive(Accounts)]
pub struct ClosePosition2022<'info> {
    pub position_authority: Signer<'info>,

    /// CHECK: safe, for receiving rent only
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,

    #[account(mut,
        close = receiver,
        seeds = [b"position".as_ref(), position_mint_2022.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = position.position_mint, owner = token_2022_program.key())]
    pub position_mint_2022: InterfaceAccount<'info, Mint>,

    #[account(mut,
        constraint = position_token_account_2022.amount == 1,
        constraint = position_token_account_2022.mint == position.position_mint
    )]
    pub position_token_account_2022: InterfaceAccount<'info, TokenAccount>,

    #[account(address = token_2022::ID)]
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<ClosePosition2022>) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account_2022,
        &ctx.accounts.position_authority,
    )?;

    if !Position::is_position_empty(&ctx.accounts.position) {
        return Err(ErrorCode::ClosePositionNotEmpty.into());
    }

    burn_and_close_user_position_token_2022(
        &ctx.accounts.position_authority,
        &ctx.accounts.receiver,
        &ctx.accounts.position_mint_2022,
        &ctx.accounts.position_token_account_2022,
        &ctx.accounts.token_2022_program,
        &ctx.accounts.position,
        &[
            b"position".as_ref(),
            ctx.accounts.position_mint_2022.key().as_ref(),
            &[ctx.bumps.position],
        ],
    )?;

    Ok(())
}

pub fn burn_and_close_user_position_token_2022<'info>(
    token_authority: &Signer<'info>,
    receiver: &UncheckedAccount<'info>,
    position_mint_2022: &InterfaceAccount<'info, Mint>,
    position_token_account_2022: &InterfaceAccount<'info, TokenAccount>,
    token_2022_program: &Program<'info, Token2022>,
    position: &Account<'info, Position>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    // Burn a single token in user account
    invoke(
        &spl_token_2022::instruction::burn_checked(
            token_2022_program.key,
            position_token_account_2022.to_account_info().key,
            position_mint_2022.to_account_info().key,
            token_authority.key,
            &[],
            1,
            position_mint_2022.decimals,
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account_2022.to_account_info(),
            position_mint_2022.to_account_info(),
            token_authority.to_account_info(),
        ],
    )?;

    // Close user account
    invoke(
        &spl_token_2022::instruction::close_account(
            token_2022_program.key,
            position_token_account_2022.to_account_info().key,
            receiver.key,
            token_authority.key,
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account_2022.to_account_info(),
            receiver.to_account_info(),
            token_authority.to_account_info(),
        ],
    )?;

    // Close mint
    invoke_signed(
        &spl_token_2022::instruction::close_account(
            token_2022_program.key,
            position_mint_2022.to_account_info().key,
            receiver.key,
            &position.key(),
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            position_mint_2022.to_account_info(),
            receiver.to_account_info(),
            position.to_account_info(),
        ],
        &[position_seeds],
    )?;

    Ok(())
}
