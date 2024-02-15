use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

use crate::errors::ErrorCode;
use crate::manager::liquidity_manager::{
    calculate_liquidity_token_deltas, calculate_modify_liquidity, sync_modify_liquidity_values,
};
use crate::math::convert_to_liquidity_delta;
use crate::state::*;
use crate::util::{to_timestamp_u64, transfer_from_owner_to_vault, verify_position_authority};

#[derive(Accounts)]
pub struct ModifyLiquidityV2<'info> {
    #[account(mut)]
    pub whirlpool: Account<'info, Whirlpool>,

    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,

    pub position_authority: Signer<'info>,

    #[account(mut, has_one = whirlpool)]
    pub position: Account<'info, Position>,
    #[account(
        constraint = position_token_account.mint == position.position_mint,
        constraint = position_token_account.amount == 1
    )]
    pub position_token_account: Box<Account<'info, token::TokenAccount>>,

    #[account(address = whirlpool.token_mint_a)]
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool.token_mint_b)]
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_vault_a.key() == whirlpool.token_vault_a)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_vault_b.key() == whirlpool.token_vault_b)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_lower: AccountLoader<'info, TickArray>,
    #[account(mut, has_one = whirlpool)]
    pub tick_array_upper: AccountLoader<'info, TickArray>,
}

pub fn handler(
    ctx: Context<ModifyLiquidityV2>,
    liquidity_amount: u128,
    token_max_a: u64,
    token_max_b: u64,
) -> Result<()> {
    verify_position_authority(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    let clock = Clock::get()?;

    if liquidity_amount == 0 {
        return Err(ErrorCode::LiquidityZero.into());
    }
    let liquidity_delta = convert_to_liquidity_delta(liquidity_amount, true)?;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let update = calculate_modify_liquidity(
        &ctx.accounts.whirlpool,
        &ctx.accounts.position,
        &ctx.accounts.tick_array_lower,
        &ctx.accounts.tick_array_upper,
        liquidity_delta,
        timestamp,
    )?;

    sync_modify_liquidity_values(
        &mut ctx.accounts.whirlpool,
        &mut ctx.accounts.position,
        &ctx.accounts.tick_array_lower,
        &ctx.accounts.tick_array_upper,
        update,
        timestamp,
    )?;

    let (delta_a, delta_b) = calculate_liquidity_token_deltas(
        ctx.accounts.whirlpool.tick_current_index,
        ctx.accounts.whirlpool.sqrt_price,
        &ctx.accounts.position,
        liquidity_delta,
    )?;

    if delta_a > token_max_a {
        return Err(ErrorCode::TokenMaxExceeded.into());
    } else if delta_b > token_max_b {
        return Err(ErrorCode::TokenMaxExceeded.into());
    }

    transfer_from_owner_to_vault(
        &ctx.accounts.position_authority,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_program,
        delta_a,
    )?;

    transfer_from_owner_to_vault(
        &ctx.accounts.position_authority,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_program,
        delta_b,
    )?;

    Ok(())
}
