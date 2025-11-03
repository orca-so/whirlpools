use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::transfer_memo;
use crate::errors::ErrorCode;
use crate::events::LiquidityRepositioned;
use crate::manager::liquidity_manager::{
    calculate_fee_and_reward_growths, calculate_liquidity_token_deltas, calculate_modify_liquidity,
    sync_modify_liquidity_values,
};
use crate::manager::tick_array_manager::update_tick_array_accounts;
use crate::math::convert_to_liquidity_delta;
use crate::state::*;
use crate::util::{
    ensure_position_has_enough_rent_for_ticks, is_locked_position, parse_remaining_accounts,
    to_timestamp_u64, transfer_from_owner_to_vault_v2, transfer_from_vault_to_owner_v2,
    verify_position_authority_interface, AccountsType, RemainingAccountsInfo,
};

#[derive(Accounts)]
pub struct Reposition<'info> {
    #[account(mut)]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,

    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,

    pub position_authority: Signer<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

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

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub existing_tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub existing_tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub new_tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub new_tick_array_upper: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Reposition<'info>>,
    new_tick_lower_index: i32,
    new_tick_upper_index: i32,
    new_liquidity_amount: u128,
    token_min_a: u64,
    token_min_b: u64,
    token_max_a: u64,
    token_max_b: u64,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    let clock = Clock::get()?;

    if is_locked_position(&ctx.accounts.position_token_account) {
        return Err(ErrorCode::OperationNotAllowedOnLockedPosition.into());
    }

    if new_liquidity_amount == 0 {
        return Err(ErrorCode::LiquidityZero.into());
    }

    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    ensure_position_has_enough_rent_for_ticks(
        &ctx.accounts.funder,
        &ctx.accounts.position,
        &ctx.accounts.system_program,
    )?;

    let current_tick_lower_index = ctx.accounts.position.tick_lower_index;
    let current_tick_upper_index = ctx.accounts.position.tick_upper_index;
    let current_liquidity_amount = ctx.accounts.position.liquidity;

    let (
        current_position_token_a_amount,
        current_position_token_b_amount,
        new_position_token_a_amount,
        new_position_token_b_amount,
        token_a_delta,
        token_b_delta,
    ) = {
        let DecreaseLiquidityResult {
            token_a_amount: current_position_token_a_amount,
            token_b_amount: current_position_token_b_amount,
            fees_owed_a,
            fees_owed_b,
            reward_infos,
        } = decrease_liquidity_from_current_position(
            &mut ctx.accounts.whirlpool,
            &mut ctx.accounts.position,
            &ctx.accounts.existing_tick_array_lower,
            &ctx.accounts.existing_tick_array_upper,
            timestamp,
            token_min_a,
            token_min_b,
        )?;

        ctx.accounts.position.reset_position_range(
            &ctx.accounts.whirlpool,
            new_tick_lower_index,
            new_tick_upper_index,
        )?;

        let (new_position_token_a_amount, new_position_token_b_amount) =
            increase_liquidity_into_current_position(
                &mut ctx.accounts.whirlpool,
                &mut ctx.accounts.position,
                &ctx.accounts.new_tick_array_lower,
                &ctx.accounts.new_tick_array_upper,
                new_liquidity_amount,
                timestamp,
            )?;

        let token_a_delta = compute_token_amount_delta(
            current_position_token_a_amount,
            new_position_token_a_amount,
            token_max_a,
        )?;
        msg!(
            "a delta: {:?}, current: {}, new: {}",
            token_a_delta,
            current_position_token_a_amount,
            new_position_token_a_amount
        );
        let token_b_delta = compute_token_amount_delta(
            current_position_token_b_amount,
            new_position_token_b_amount,
            token_max_b,
        )?;
        msg!(
            "b delta: {:?}, current: {}, new: {}",
            token_b_delta,
            current_position_token_b_amount,
            new_position_token_b_amount
        );

        // After increase_liquidity, the new position range will have new growth checkpoints,
        // but fees_owed and reward_infos were zeroed during reset. This restores the previous values
        // so that users can still collect previously accumulated fees/rewards.
        ctx.accounts
            .position
            .update_fees_owed(fees_owed_a, fees_owed_b);
        reward_infos
            .iter()
            .enumerate()
            .for_each(|(i, reward_info)| {
                ctx.accounts
                    .position
                    .update_reward_owed(i, reward_info.amount_owed);
            });

        (
            current_position_token_a_amount,
            current_position_token_b_amount,
            new_position_token_a_amount,
            new_position_token_b_amount,
            token_a_delta,
            token_b_delta,
        )
    };

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        ctx.remaining_accounts,
        &remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    settle_via_spl_transfer(
        &ctx.accounts.whirlpool,
        &ctx.accounts.position_authority,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_program_a,
        &remaining_accounts.transfer_hook_a,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_program_b,
        &remaining_accounts.transfer_hook_b,
        &ctx.accounts.memo_program,
        token_a_delta,
        token_b_delta,
    )?;

    emit!(LiquidityRepositioned {
        whirlpool: ctx.accounts.whirlpool.key(),
        position: ctx.accounts.position.key(),
        old_tick_lower_index: current_tick_lower_index,
        old_tick_upper_index: current_tick_upper_index,
        new_tick_lower_index,
        new_tick_upper_index,
        old_liquidity: current_liquidity_amount,
        new_liquidity: new_liquidity_amount,
        old_token_a_amount: current_position_token_a_amount,
        old_token_b_amount: current_position_token_b_amount,
        new_token_a_amount: new_position_token_a_amount,
        new_token_b_amount: new_position_token_b_amount,
    });

    Ok(())
}

struct DecreaseLiquidityResult {
    token_a_amount: u64,
    token_b_amount: u64,
    fees_owed_a: u64,
    fees_owed_b: u64,
    reward_infos: [PositionRewardInfo; NUM_REWARDS],
}

fn decrease_liquidity_from_current_position<'info>(
    whirlpool: &mut Account<'info, Whirlpool>,
    position: &mut Account<'info, Position>,
    existing_tick_array_lower: &AccountInfo<'info>,
    existing_tick_array_upper: &AccountInfo<'info>,
    timestamp: u64,
    token_min_a: u64,
    token_min_b: u64,
) -> Result<DecreaseLiquidityResult> {
    let position_current_liquidity = position.liquidity;

    let mut tick_arrays = TickArraysMut::load(
        existing_tick_array_lower,
        existing_tick_array_upper,
        &whirlpool.key(),
    )?;

    let (lower_tick_array, upper_tick_array) = tick_arrays.deref();
    let (position_update, _whirlpool_reward_infos) = calculate_fee_and_reward_growths(
        whirlpool,
        position,
        lower_tick_array,
        upper_tick_array,
        timestamp,
    )?;

    let current_fees_owed_a = position_update.fee_owed_a;
    let current_fees_owed_b = position_update.fee_owed_b;
    let current_reward_infos = position_update.reward_infos;

    // A position without liquidity can still have its range reset
    if position_current_liquidity == 0 {
        return Ok(DecreaseLiquidityResult {
            token_a_amount: 0,
            token_b_amount: 0,
            fees_owed_a: current_fees_owed_a,
            fees_owed_b: current_fees_owed_b,
            reward_infos: current_reward_infos,
        });
    }

    let liquidity_delta = convert_to_liquidity_delta(position_current_liquidity, false)?;
    let modify_liquidity_update = calculate_modify_liquidity(
        whirlpool,
        position,
        lower_tick_array,
        upper_tick_array,
        liquidity_delta,
        timestamp,
    )?;

    let (lower_tick_array_mut, upper_tick_array_mut) = tick_arrays.deref_mut();
    sync_modify_liquidity_values(
        whirlpool,
        position,
        lower_tick_array_mut,
        upper_tick_array_mut,
        &modify_liquidity_update,
        timestamp,
    )?;

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    update_tick_array_accounts(
        position,
        existing_tick_array_lower.to_account_info(),
        existing_tick_array_upper.to_account_info(),
        &modify_liquidity_update.tick_array_lower_update,
        &modify_liquidity_update.tick_array_upper_update,
    )?;

    let (token_a_delta, token_b_delta) = calculate_liquidity_token_deltas(
        whirlpool.tick_current_index,
        whirlpool.sqrt_price,
        position,
        liquidity_delta,
    )?;

    // token_min_a and token_min_b can ignore any transfer fee excluded amount
    // since there is no SPL transfer here. There will only be 1-2 transfers depending
    // on the token amount deltas.
    if token_a_delta < token_min_a {
        return Err(ErrorCode::TokenMinSubceeded.into());
    }

    if token_b_delta < token_min_b {
        return Err(ErrorCode::TokenMinSubceeded.into());
    }

    position.reset_fees_owed();
    for i in 0..NUM_REWARDS {
        position.update_reward_owed(i, 0);
    }

    Ok(DecreaseLiquidityResult {
        token_a_amount: token_a_delta,
        token_b_amount: token_b_delta,
        fees_owed_a: current_fees_owed_a,
        fees_owed_b: current_fees_owed_b,
        reward_infos: current_reward_infos,
    })
}

fn increase_liquidity_into_current_position<'info>(
    whirlpool: &mut Account<'info, Whirlpool>,
    position: &mut Account<'info, Position>,
    new_tick_array_lower: &AccountInfo<'info>,
    new_tick_array_upper: &AccountInfo<'info>,
    new_liquidity_amount: u128,
    timestamp: u64,
) -> Result<(u64, u64)> {
    let liquidity_delta = convert_to_liquidity_delta(new_liquidity_amount, true)?;

    let tick_arrays =
        TickArraysMut::load(new_tick_array_lower, new_tick_array_upper, &whirlpool.key())?;

    let (lower_tick_array, upper_tick_array) = tick_arrays.deref();
    let modify_liquidity_update = calculate_modify_liquidity(
        whirlpool,
        position,
        lower_tick_array,
        upper_tick_array,
        liquidity_delta,
        timestamp,
    )?;

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    update_tick_array_accounts(
        position,
        new_tick_array_lower.to_account_info(),
        new_tick_array_upper.to_account_info(),
        &modify_liquidity_update.tick_array_lower_update,
        &modify_liquidity_update.tick_array_upper_update,
    )?;

    let mut tick_arrays =
        TickArraysMut::load(new_tick_array_lower, new_tick_array_upper, &whirlpool.key())?;

    let (lower_tick_array_mut, upper_tick_array_mut) = tick_arrays.deref_mut();
    sync_modify_liquidity_values(
        whirlpool,
        position,
        lower_tick_array_mut,
        upper_tick_array_mut,
        &modify_liquidity_update,
        timestamp,
    )?;

    let (token_a_amount, token_b_amount) = calculate_liquidity_token_deltas(
        whirlpool.tick_current_index,
        whirlpool.sqrt_price,
        position,
        liquidity_delta,
    )?;

    Ok((token_a_amount, token_b_amount))
}

#[derive(Debug)]
struct TokenDelta {
    amount: u64,
    is_increase: bool,
}

fn compute_token_amount_delta(
    existing_amount: u64,
    new_amount: u64,
    token_max: u64,
) -> Result<TokenDelta> {
    let (net_amount, is_increase) = if existing_amount > new_amount {
        (existing_amount - new_amount, false) // User receives tokens
    } else {
        (new_amount - existing_amount, true) // User sends tokens
    };

    if is_increase && net_amount > token_max {
        return Err(ErrorCode::TokenMaxExceeded.into());
    }

    Ok(TokenDelta {
        amount: net_amount,
        is_increase,
    })
}

fn settle_via_spl_transfer<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    position_authority: &Signer<'info>,
    token_mint_a: &InterfaceAccount<'info, Mint>,
    token_vault_a: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_a: &InterfaceAccount<'info, TokenAccount>,
    token_program_a: &Interface<'info, TokenInterface>,
    transfer_hook_a_accounts: &Option<Vec<AccountInfo<'info>>>,
    token_mint_b: &InterfaceAccount<'info, Mint>,
    token_vault_b: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_b: &InterfaceAccount<'info, TokenAccount>,
    token_program_b: &Interface<'info, TokenInterface>,
    transfer_hook_b_accounts: &Option<Vec<AccountInfo<'info>>>,
    memo_program: &Program<'info, Memo>,
    token_a_delta: TokenDelta,
    token_b_delta: TokenDelta,
) -> Result<()> {
    if !token_a_delta.is_increase {
        transfer_from_vault_to_owner_v2(
            whirlpool,
            token_mint_a,
            token_vault_a,
            token_owner_account_a,
            token_program_a,
            memo_program,
            transfer_hook_a_accounts,
            token_a_delta.amount,
            transfer_memo::TRANSFER_MEMO_DECREASE_LIQUIDITY.as_bytes(),
        )?;
    } else {
        transfer_from_owner_to_vault_v2(
            position_authority,
            token_mint_a,
            token_owner_account_a,
            token_vault_a,
            token_program_a,
            memo_program,
            transfer_hook_a_accounts,
            token_a_delta.amount,
        )?;
    }

    if !token_b_delta.is_increase {
        transfer_from_vault_to_owner_v2(
            whirlpool,
            token_mint_b,
            token_vault_b,
            token_owner_account_b,
            token_program_b,
            memo_program,
            transfer_hook_b_accounts,
            token_b_delta.amount,
            transfer_memo::TRANSFER_MEMO_DECREASE_LIQUIDITY.as_bytes(),
        )?;
    } else {
        transfer_from_owner_to_vault_v2(
            position_authority,
            token_mint_b,
            token_owner_account_b,
            token_vault_b,
            token_program_b,
            memo_program,
            transfer_hook_b_accounts,
            token_b_delta.amount,
        )?;
    }

    Ok(())
}
