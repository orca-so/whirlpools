use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::manager::liquidity_manager::{
    calculate_liquidity_token_deltas, calculate_modify_liquidity, sync_modify_liquidity_values,
};
use crate::math::convert_to_liquidity_delta;
use crate::util::{to_timestamp_u64, transfer_from_vault_to_owner, verify_position_authority};

use super::ModifyLiquidity;

/*
  Removes liquidity from an existing Whirlpool Position.
*/
pub fn handler(
    ctx: Context<ModifyLiquidity>,
    liquidity_amount: u128,
    token_min_a: u64,
    token_min_b: u64,
) -> Result<()> {
    verify_position_authority(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    let clock = Clock::get()?;

    if liquidity_amount == 0 {
        return Err(ErrorCode::LiquidityZero.into());
    }
    let liquidity_delta = convert_to_liquidity_delta(liquidity_amount, false)?;
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

    if delta_a < token_min_a {
        return Err(ErrorCode::TokenMinSubceeded.into());
    } else if delta_b < token_min_b {
        return Err(ErrorCode::TokenMinSubceeded.into());
    }

    transfer_from_vault_to_owner(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_program,
        delta_a,
    )?;

    transfer_from_vault_to_owner(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_program,
        delta_b,
    )?;

    Ok(())
}
