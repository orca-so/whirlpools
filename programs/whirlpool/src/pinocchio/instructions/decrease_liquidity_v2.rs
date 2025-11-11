use crate::pinocchio::{
    errors::WhirlpoolErrorCode,
    ported::{
        manager_liquidity_manager::{
            pino_calculate_liquidity_token_deltas, pino_calculate_modify_liquidity,
            pino_sync_modify_liquidity_values,
        },
        manager_tick_array_manager::pino_update_tick_array_accounts,
        util_remaining_accounts_utils::pino_parse_remaining_accounts,
        util_shared::{pino_is_locked_position, pino_verify_position_authority},
        util_token::{
            pino_calculate_transfer_fee_excluded_amount, pino_transfer_from_vault_to_owner_v2,
        },
    },
    state::{
        token::MemoryMappedTokenAccount,
        whirlpool::{
            tick_array::loader::TickArraysMut, MemoryMappedPosition, MemoryMappedWhirlpool,
        },
    },
    utils::{
        account_info_iter::AccountIterator,
        account_load::{load_account_mut, load_token_program_account},
        verify::{verify_address, verify_constraint},
    },
    Result,
};
use crate::{
    constants::transfer_memo,
    math::convert_to_liquidity_delta,
    util::{to_timestamp_u64, AccountsType},
};
use pinocchio::account_info::AccountInfo;
use pinocchio::sysvars::{clock::Clock, Sysvar};

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::DecreaseLiquidityV2::try_from_slice(&data[8..])?;

    // account labeling
    let mut iter = AccountIterator::new(accounts);
    let whirlpool_info = iter.next_mut()?;
    let token_program_a_info = iter.next_program_token_or_token_2022()?;
    let token_program_b_info = iter.next_program_token_or_token_2022()?;
    let memo_program_info = iter.next_program_memo()?;
    let position_authority_info = iter.next_signer()?;
    let position_info = iter.next_mut()?;
    let position_token_account_info = iter.next()?;
    let token_mint_a_info = iter.next()?;
    let token_mint_b_info = iter.next()?;
    let token_owner_account_a_info = iter.next_mut()?;
    let token_owner_account_b_info = iter.next_mut()?;
    let token_vault_a_info = iter.next_mut()?;
    let token_vault_b_info = iter.next_mut()?;
    let tick_array_lower_info = iter.next_mut()?;
    let tick_array_upper_info = iter.next_mut()?;
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
    let remaining_accounts = iter.remaining_accounts();

    // account validation
    // whirlpool_info
    let mut whirlpool = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_info)?;
    // token_program_a: done
    verify_address(token_program_a_info.key(), token_mint_a_info.owner())?;
    // token_program_b: done
    verify_address(token_program_b_info.key(), token_mint_b_info.owner())?;
    // memo_program: done
    // position_authority_info: done
    // position_info
    let mut position = load_account_mut::<MemoryMappedPosition>(position_info)?;
    verify_address(position.whirlpool(), whirlpool_info.key())?;
    // position_token_account_info
    let position_token_account =
        load_token_program_account::<MemoryMappedTokenAccount>(position_token_account_info)?;
    verify_constraint(position_token_account.mint() == position.position_mint())?;
    verify_constraint(position_token_account.amount() == 1)?;
    // token_mint_a_info
    verify_address(token_mint_a_info.key(), whirlpool.token_mint_a())?;
    // token_mint_b_info
    verify_address(token_mint_b_info.key(), whirlpool.token_mint_b())?;
    // token_owner_account_a_info: we don't need to verify this account, token program will verify it
    // token_owner_account_b_info: we don't need to verify this account, token program will verify it
    // token_vault_a_info
    verify_address(token_vault_a_info.key(), whirlpool.token_vault_a())?;
    // token_vault_b_info
    verify_address(token_vault_b_info.key(), whirlpool.token_vault_b())?;
    // tick_array_lower_info: TickArraysMut::load will verify it
    // tick_array_upper_info: TickArraysMut::load will verify it

    // The beginning of handler core logic

    pino_verify_position_authority(&position_token_account, position_authority_info)?;

    if pino_is_locked_position(&position_token_account) {
        return Err(WhirlpoolErrorCode::OperationNotAllowedOnLockedPosition.into());
    }
    drop(position_token_account);

    let clock = Clock::get()?;

    if data.liquidity_amount == 0 {
        return Err(WhirlpoolErrorCode::LiquidityZero.into());
    }

    // Process remaining accounts
    let remaining_accounts = pino_parse_remaining_accounts(
        remaining_accounts,
        &data.remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    let liquidity_delta = convert_to_liquidity_delta(data.liquidity_amount, false)?;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let mut tick_arrays = TickArraysMut::load(
        tick_array_lower_info,
        tick_array_upper_info,
        whirlpool_info.key(),
    )?;

    let (lower_tick_array, upper_tick_array) = tick_arrays.deref();
    let update = pino_calculate_modify_liquidity(
        &whirlpool,
        &position,
        lower_tick_array,
        upper_tick_array,
        liquidity_delta,
        timestamp,
    )?;

    let (lower_tick_array_mut, upper_tick_array_mut) = tick_arrays.deref_mut();
    pino_sync_modify_liquidity_values(
        &mut whirlpool,
        &mut position,
        lower_tick_array_mut,
        upper_tick_array_mut,
        &update,
        timestamp,
    )?;

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    pino_update_tick_array_accounts(
        position_info,
        tick_array_lower_info,
        tick_array_upper_info,
        &update.tick_array_lower_update,
        &update.tick_array_upper_update,
    )?;

    let (delta_a, delta_b) = pino_calculate_liquidity_token_deltas(
        whirlpool.tick_current_index(),
        whirlpool.sqrt_price(),
        &position,
        liquidity_delta,
    )?;

    let transfer_fee_excluded_delta_a =
        pino_calculate_transfer_fee_excluded_amount(token_mint_a_info, delta_a)?;
    let transfer_fee_excluded_delta_b =
        pino_calculate_transfer_fee_excluded_amount(token_mint_b_info, delta_b)?;

    // token_min_a and token_min_b should be applied to the transfer fee excluded amount
    if transfer_fee_excluded_delta_a.amount < data.token_min_a {
        return Err(WhirlpoolErrorCode::TokenMinSubceeded.into());
    }
    if transfer_fee_excluded_delta_b.amount < data.token_min_b {
        return Err(WhirlpoolErrorCode::TokenMinSubceeded.into());
    }

    pino_transfer_from_vault_to_owner_v2(
        &whirlpool,
        whirlpool_info,
        token_mint_a_info,
        token_vault_a_info,
        token_owner_account_a_info,
        token_program_a_info,
        memo_program_info,
        &remaining_accounts.transfer_hook_a,
        delta_a,
        transfer_memo::TRANSFER_MEMO_DECREASE_LIQUIDITY.as_bytes(),
    )?;

    pino_transfer_from_vault_to_owner_v2(
        &whirlpool,
        whirlpool_info,
        token_mint_b_info,
        token_vault_b_info,
        token_owner_account_b_info,
        token_program_b_info,
        memo_program_info,
        &remaining_accounts.transfer_hook_b,
        delta_b,
        transfer_memo::TRANSFER_MEMO_DECREASE_LIQUIDITY.as_bytes(),
    )?;

    /*
    emit!(LiquidityDecreased {
        whirlpool: ctx.accounts.whirlpool.key(),
        position: ctx.accounts.position.key(),
        tick_lower_index: ctx.accounts.position.tick_lower_index,
        tick_upper_index: ctx.accounts.position.tick_upper_index,
        liquidity: liquidity_amount,
        token_a_amount: delta_a,
        token_b_amount: delta_b,
        token_a_transfer_fee: transfer_fee_excluded_delta_a.transfer_fee,
        token_b_transfer_fee: transfer_fee_excluded_delta_b.transfer_fee,
    });
    */

    Ok(())
}
