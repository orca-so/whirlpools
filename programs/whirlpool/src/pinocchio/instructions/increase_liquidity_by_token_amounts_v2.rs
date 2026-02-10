use crate::{
    instructions::IncreaseLiquidityMethod,
    math::convert_to_liquidity_delta,
    pinocchio::events::Event,
    util::{to_timestamp_u64, AccountsType},
};
use crate::{
    math::estimate_max_liquidity_from_token_amounts,
    pinocchio::{
        errors::WhirlpoolErrorCode,
        ported::{
            manager_liquidity_manager::{
                pino_calculate_liquidity_token_deltas, pino_calculate_modify_liquidity,
                pino_sync_modify_liquidity_values,
            },
            manager_tick_array_manager::pino_update_tick_array_accounts,
            util_remaining_accounts_utils::pino_parse_remaining_accounts,
            util_shared::pino_verify_position_authority,
            util_token::{
                pino_calculate_transfer_fee_excluded_amount,
                pino_calculate_transfer_fee_included_amount, pino_transfer_from_owner_to_vault_v2,
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
    },
};
use pinocchio::account_info::AccountInfo;
use pinocchio::sysvars::{clock::Clock, Sysvar};

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::IncreaseLiquidityByTokenAmountsV2::try_from_slice(&data[8..])?;

    let (token_max_a, token_max_b, min_sqrt_price, max_sqrt_price) = match data.method {
        IncreaseLiquidityMethod::ByTokenAmounts {
            token_max_a,
            token_max_b,
            min_sqrt_price,
            max_sqrt_price,
        } => (token_max_a, token_max_b, min_sqrt_price, max_sqrt_price),
    };

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
    drop(position_token_account);

    let current_sqrt_price = whirlpool.sqrt_price();

    if current_sqrt_price < min_sqrt_price || current_sqrt_price > max_sqrt_price {
        return Err(WhirlpoolErrorCode::PriceSlippageOutOfBounds.into());
    }

    let max_delta_a =
        pino_calculate_transfer_fee_excluded_amount(token_mint_a_info, token_max_a)?.amount;
    let max_delta_b =
        pino_calculate_transfer_fee_excluded_amount(token_mint_b_info, token_max_b)?.amount;

    let liquidity_amount = estimate_max_liquidity_from_token_amounts(
        current_sqrt_price,
        position.tick_lower_index(),
        position.tick_upper_index(),
        max_delta_a,
        max_delta_b,
    )?;

    if liquidity_amount == 0 {
        return Err(WhirlpoolErrorCode::LiquidityZero.into());
    }

    let clock = Clock::get()?;

    // Process remaining accounts
    let remaining_accounts = pino_parse_remaining_accounts(
        remaining_accounts,
        &data.remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    let liquidity_delta = convert_to_liquidity_delta(liquidity_amount, true)?;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let tick_arrays = TickArraysMut::load(
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

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    pino_update_tick_array_accounts(
        position_info,
        tick_array_lower_info,
        tick_array_upper_info,
        &update.tick_array_lower_update,
        &update.tick_array_upper_update,
    )?;

    let mut tick_arrays = TickArraysMut::load(
        tick_array_lower_info,
        tick_array_upper_info,
        whirlpool_info.key(),
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

    let (delta_a, delta_b) = pino_calculate_liquidity_token_deltas(
        whirlpool.tick_current_index(),
        current_sqrt_price,
        &position,
        liquidity_delta,
    )?;

    let transfer_fee_included_delta_a =
        pino_calculate_transfer_fee_included_amount(token_mint_a_info, delta_a)?;
    let transfer_fee_included_delta_b =
        pino_calculate_transfer_fee_included_amount(token_mint_b_info, delta_b)?;

    // token_max_a and token_max_b should be applied to the transfer fee included amount
    if transfer_fee_included_delta_a.amount > token_max_a {
        return Err(WhirlpoolErrorCode::TokenMaxExceeded.into());
    }
    if transfer_fee_included_delta_b.amount > token_max_b {
        return Err(WhirlpoolErrorCode::TokenMaxExceeded.into());
    }

    pino_transfer_from_owner_to_vault_v2(
        position_authority_info,
        token_mint_a_info,
        token_owner_account_a_info,
        token_vault_a_info,
        token_program_a_info,
        memo_program_info,
        &remaining_accounts.transfer_hook_a,
        transfer_fee_included_delta_a.amount,
    )?;

    pino_transfer_from_owner_to_vault_v2(
        position_authority_info,
        token_mint_b_info,
        token_owner_account_b_info,
        token_vault_b_info,
        token_program_b_info,
        memo_program_info,
        &remaining_accounts.transfer_hook_b,
        transfer_fee_included_delta_b.amount,
    )?;

    Event::LiquidityIncreased {
        whirlpool: whirlpool_info.key(),
        position: position_info.key(),
        tick_lower_index: position.tick_lower_index(),
        tick_upper_index: position.tick_upper_index(),
        liquidity: liquidity_amount,
        token_a_amount: transfer_fee_included_delta_a.amount,
        token_b_amount: transfer_fee_included_delta_b.amount,
        token_a_transfer_fee: transfer_fee_included_delta_a.transfer_fee,
        token_b_transfer_fee: transfer_fee_included_delta_b.transfer_fee,
    }
    .emit()?;

    Ok(())
}
