use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::ErrorCode;
use crate::state::*;
use crate::util::{
    freeze_user_position_token_2022, is_locked_position, verify_position_authority_interface,
};

#[derive(Accounts)]
pub struct LockPosition<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    pub position_authority: Signer<'info>,

    #[account(
        seeds = [b"position".as_ref(), position_mint.key().as_ref()],
        bump,
        has_one = whirlpool,
    )]
    pub position: Account<'info, Position>,

    #[account(address = position.position_mint, owner = token_2022_program.key())]
    pub position_mint: InterfaceAccount<'info, Mint>,

    #[account(mut,
        constraint = position_token_account.amount == 1,
        constraint = position_token_account.mint == position.position_mint,
        constraint = !position_token_account.is_frozen(),
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(init,
        payer = funder,
        space = LockConfig::LEN,
        seeds = [b"lock_config".as_ref(), position.key().as_ref()],
        bump,
    )]
    pub lock_config: Box<Account<'info, LockConfig>>,

    pub whirlpool: Account<'info, Whirlpool>,

    #[account(address = token_2022::ID)]
    pub token_2022_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LockPosition>, lock_type: LockType) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    if is_locked_position(&ctx.accounts.position_token_account) {
        // This case should be rejected by initialization of LockConfig account
        unreachable!("Position is already locked");
    }

    // only non-empty positions can be locked
    if ctx.accounts.position.liquidity == 0 {
        return Err(ErrorCode::PositionNotLockable.into());
    }

    freeze_user_position_token_2022(
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

    ctx.accounts.lock_config.initialize(
        ctx.accounts.position.key(),
        // position owner is different from position authority if delegation is used
        ctx.accounts.position_token_account.owner,
        ctx.accounts.position.whirlpool,
        Clock::get()?.unix_timestamp as u64,
        lock_type,
    )?;

    Ok(())
}
