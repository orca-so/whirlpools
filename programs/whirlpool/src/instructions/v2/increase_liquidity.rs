use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::ErrorCode;
use crate::events::*;
use crate::manager::liquidity_manager::{
    calculate_liquidity_token_deltas, calculate_modify_liquidity, sync_modify_liquidity_values,
};
use crate::manager::tick_array_manager::update_tick_array_accounts;
use crate::math::convert_to_liquidity_delta;
use crate::state::*;
use crate::util::{
    calculate_transfer_fee_included_amount, parse_remaining_accounts, AccountsType,
    RemainingAccountsInfo,
};
use crate::util::{
    to_timestamp_u64, v2::transfer_from_owner_to_vault_v2, verify_position_authority_interface,
};

#[derive(Accounts)]
pub struct ModifyLiquidityV2<'info> {
    #[account(mut)]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,

    pub position_authority: Signer<'info>,

    #[account(mut, has_one = whirlpool)]
    pub position: Account<'info, Position>,
    #[account(
        constraint = position_token_account.mint == position.position_mint,
        constraint = position_token_account.amount == 1
    )]
    pub position_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

    #[account(mut)]
    /// CHECK: Checked by the tick array loader
    pub tick_array_lower: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Checked by the tick array loader
    pub tick_array_upper: UncheckedAccount<'info>,
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ModifyLiquidityV2<'info>>,
    liquidity_amount: u128,
    token_max_a: u64,
    token_max_b: u64,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    let clock = Clock::get()?;

    if liquidity_amount == 0 {
        return Err(ErrorCode::LiquidityZero.into());
    }

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        ctx.remaining_accounts,
        &remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    let liquidity_delta = convert_to_liquidity_delta(liquidity_amount, true)?;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let tick_arrays = TickArraysMut::load(
        &ctx.accounts.tick_array_lower,
        &ctx.accounts.tick_array_upper,
        &ctx.accounts.whirlpool.key(),
    )?;

    let (lower_tick_array, upper_tick_array) = tick_arrays.deref();
    let update = calculate_modify_liquidity(
        &ctx.accounts.whirlpool,
        &ctx.accounts.position,
        lower_tick_array,
        upper_tick_array,
        liquidity_delta,
        timestamp,
    )?;

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    update_tick_array_accounts(
        &ctx.accounts.position,
        ctx.accounts.tick_array_lower.to_account_info(),
        ctx.accounts.tick_array_upper.to_account_info(),
        &update.tick_array_lower_update,
        &update.tick_array_upper_update,
    )?;

    let mut tick_arrays = TickArraysMut::load(
        &ctx.accounts.tick_array_lower,
        &ctx.accounts.tick_array_upper,
        &ctx.accounts.whirlpool.key(),
    )?;

    let (lower_tick_array_mut, upper_tick_array_mut) = tick_arrays.deref_mut();
    sync_modify_liquidity_values(
        &mut ctx.accounts.whirlpool,
        &mut ctx.accounts.position,
        lower_tick_array_mut,
        upper_tick_array_mut,
        &update,
        timestamp,
    )?;

    let (delta_a, delta_b) = calculate_liquidity_token_deltas(
        ctx.accounts.whirlpool.tick_current_index,
        ctx.accounts.whirlpool.sqrt_price,
        &ctx.accounts.position,
        liquidity_delta,
    )?;

    let transfer_fee_included_delta_a =
        calculate_transfer_fee_included_amount(&ctx.accounts.token_mint_a, delta_a)?;
    let transfer_fee_included_delta_b =
        calculate_transfer_fee_included_amount(&ctx.accounts.token_mint_b, delta_b)?;

    // token_max_a and token_max_b should be applied to the transfer fee included amount
    if transfer_fee_included_delta_a.amount > token_max_a {
        return Err(ErrorCode::TokenMaxExceeded.into());
    }
    if transfer_fee_included_delta_b.amount > token_max_b {
        return Err(ErrorCode::TokenMaxExceeded.into());
    }

    transfer_from_owner_to_vault_v2(
        &ctx.accounts.position_authority,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_program_a,
        &ctx.accounts.memo_program,
        &remaining_accounts.transfer_hook_a,
        transfer_fee_included_delta_a.amount,
    )?;

    transfer_from_owner_to_vault_v2(
        &ctx.accounts.position_authority,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_program_b,
        &ctx.accounts.memo_program,
        &remaining_accounts.transfer_hook_b,
        transfer_fee_included_delta_b.amount,
    )?;

    emit!(LiquidityIncreased {
        whirlpool: ctx.accounts.whirlpool.key(),
        position: ctx.accounts.position.key(),
        tick_lower_index: ctx.accounts.position.tick_lower_index,
        tick_upper_index: ctx.accounts.position.tick_upper_index,
        liquidity: liquidity_amount,
        token_a_amount: transfer_fee_included_delta_a.amount,
        token_b_amount: transfer_fee_included_delta_b.amount,
        token_a_transfer_fee: transfer_fee_included_delta_a.transfer_fee,
        token_b_transfer_fee: transfer_fee_included_delta_b.transfer_fee,
    });

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub enum IncreaseLiquidityMethod {
    ByTokenAmounts {
        token_max_a: u64,
        token_max_b: u64,
        min_sqrt_price: u128,
        max_sqrt_price: u128,
    },
}
