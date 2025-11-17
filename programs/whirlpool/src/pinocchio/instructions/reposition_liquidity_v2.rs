use crate::{
    constants::transfer_memo,
    instructions::RepositionLiquidityMethod,
    math::convert_to_liquidity_delta,
    pinocchio::{
        errors::WhirlpoolErrorCode,
        events::Event,
        ported::{
            manager_liquidity_manager::{
                pino_calculate_fee_and_reward_growths, pino_calculate_liquidity_token_deltas,
                pino_calculate_modify_liquidity, pino_sync_modify_liquidity_values,
            },
            manager_tick_array_manager::pino_update_tick_array_accounts,
            position::pino_ensure_position_has_enough_rent_for_ticks,
            util_remaining_accounts_utils::pino_parse_remaining_accounts,
            util_shared::{pino_is_locked_position, pino_verify_position_authority},
            util_token::{
                pino_calculate_transfer_fee_excluded_amount,
                pino_calculate_transfer_fee_included_amount, pino_transfer_from_owner_to_vault_v2,
                pino_transfer_from_vault_to_owner_v2,
            },
        },
        state::{
            token::MemoryMappedTokenAccount,
            whirlpool::{
                tick_array::{loader::TickArraysMut, NUM_REWARDS},
                MemoryMappedPosition, MemoryMappedWhirlpool,
            },
        },
        utils::{
            account_info_iter::AccountIterator,
            account_load::{load_account_mut, load_token_program_account},
            verify::{verify_address, verify_constraint},
        },
        Result,
    },
    state::PositionRewardInfo,
    util::{to_timestamp_u64, AccountsType},
};
use pinocchio::sysvars::Sysvar;
use pinocchio::{account_info::AccountInfo, pubkey::Pubkey, sysvars::clock::Clock};

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::RepositionLiquidityV2::try_from_slice(&data[8..])?;

    let (
        new_liquidity_amount,
        existing_range_token_min_a,
        existing_range_token_min_b,
        new_range_token_max_a,
        new_range_token_max_b,
    ) = match data.method {
        RepositionLiquidityMethod::ByLiquidity {
            new_liquidity_amount,
            existing_range_token_min_a,
            existing_range_token_min_b,
            new_range_token_max_a,
            new_range_token_max_b,
        } => (
            new_liquidity_amount,
            existing_range_token_min_a,
            existing_range_token_min_b,
            new_range_token_max_a,
            new_range_token_max_b,
        ),
    };

    if new_liquidity_amount == 0 {
        Err(WhirlpoolErrorCode::LiquidityZero)?;
    }

    let mut iter = AccountIterator::new(accounts);
    let whirlpool_info = iter.next_mut()?;
    let token_program_a_info = iter.next_program_token_or_token_2022()?;
    let token_program_b_info = iter.next_program_token_or_token_2022()?;
    let memo_program_info = iter.next_program_memo()?;
    let position_authority_info = iter.next_signer()?;
    let funder_info = iter.next_signer_mut()?;
    let position_account_info = iter.next_mut()?;
    let position_token_account_info = iter.next()?;
    let token_mint_a_info = iter.next()?;
    let token_mint_b_info = iter.next()?;
    let token_owner_account_a_info = iter.next_mut()?;
    let token_owner_account_b_info = iter.next_mut()?;
    let token_vault_a_info = iter.next_mut()?;
    let token_vault_b_info = iter.next_mut()?;
    let existing_tick_array_lower_info = iter.next_mut()?;
    let existing_tick_array_upper_info = iter.next_mut()?;
    let new_tick_array_lower_info = iter.next_mut()?;
    let new_tick_array_upper_info = iter.next_mut()?;
    let system_program_info = iter.next_program_system()?;
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
    let remaining_accounts = iter.remaining_accounts();

    pino_ensure_position_has_enough_rent_for_ticks(
        funder_info,
        position_account_info,
        system_program_info,
    )?;

    let mut whirlpool = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_info)?;
    verify_address(token_program_a_info.key(), token_mint_a_info.owner())?;
    verify_address(token_program_b_info.key(), token_mint_b_info.owner())?;
    let mut position = load_account_mut::<MemoryMappedPosition>(position_account_info)?;
    verify_address(position.whirlpool(), whirlpool_info.key())?;
    let position_token_account =
        load_token_program_account::<MemoryMappedTokenAccount>(position_token_account_info)?;

    verify_constraint(position_token_account.mint() == position.position_mint())?;
    verify_constraint(position_token_account.amount() == 1)?;
    verify_address(token_mint_a_info.key(), whirlpool.token_mint_a())?;
    verify_address(token_mint_b_info.key(), whirlpool.token_mint_b())?;
    verify_address(token_vault_a_info.key(), whirlpool.token_vault_a())?;
    verify_address(token_vault_b_info.key(), whirlpool.token_vault_b())?;
    // token owner accounts: token program will verify them
    // tick array accounts: TickArraysMut::load will verify it

    pino_verify_position_authority(&position_token_account, position_authority_info)?;
    if pino_is_locked_position(&position_token_account) {
        return Err(WhirlpoolErrorCode::OperationNotAllowedOnLockedPosition.into());
    }

    drop(position_token_account);

    let clock = Clock::get()?;

    let remaining_accounts = pino_parse_remaining_accounts(
        remaining_accounts,
        &data.remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let existing_range_tick_lower_index = position.tick_lower_index();
    let existing_range_tick_upper_index = position.tick_upper_index();
    let existing_range_liquidity = position.liquidity();

    let mut existing_range_token_a_decrease_amount = 0u64;
    let mut existing_range_token_b_decrease_amount = 0u64;
    let mut fees_owed_a = 0u64;
    let mut fees_owed_b = 0u64;
    let mut reward_infos = [PositionRewardInfo::default(); NUM_REWARDS];

    decrease_liquidity_from_existing_range(
        whirlpool_info.key(),
        &mut whirlpool,
        &mut position,
        position_account_info,
        existing_tick_array_lower_info,
        existing_tick_array_upper_info,
        timestamp,
        &mut existing_range_token_a_decrease_amount,
        &mut existing_range_token_b_decrease_amount,
        &mut fees_owed_a,
        &mut fees_owed_b,
        &mut reward_infos,
    )?;

    // Even though there is no token transfer at this point, we use the transfer fee excluded amount
    // to ensure that withdrawing existing position range tokens would not exceed the minimum
    // limits. This is consistent with the behavior of the standalone decrease_liquidity instruction.
    let transfer_fee_excluded_amount_a = pino_calculate_transfer_fee_excluded_amount(
        token_mint_a_info,
        existing_range_token_a_decrease_amount,
    )?;
    if transfer_fee_excluded_amount_a.amount < existing_range_token_min_a {
        return Err(WhirlpoolErrorCode::TokenMinSubceeded.into());
    }

    let transfer_fee_excluded_amount_b = pino_calculate_transfer_fee_excluded_amount(
        token_mint_b_info,
        existing_range_token_b_decrease_amount,
    )?;
    if transfer_fee_excluded_amount_b.amount < existing_range_token_min_b {
        return Err(WhirlpoolErrorCode::TokenMinSubceeded.into());
    }

    position.reset_position_range(
        &whirlpool,
        data.new_tick_lower_index,
        data.new_tick_upper_index,
    )?;

    let (new_range_token_a_increase_amount, new_range_token_b_increase_amount) =
        increase_liquidity_into_new_range(
            whirlpool_info.key(),
            &mut whirlpool,
            &mut position,
            position_account_info,
            new_tick_array_lower_info,
            new_tick_array_upper_info,
            new_liquidity_amount,
            timestamp,
        )?;

    let (token_a_delta, is_token_a_transfer_from_owner) = calculate_token_delta(
        existing_range_token_a_decrease_amount,
        new_range_token_a_increase_amount,
    );
    let (token_a_transfer_amount, token_a_transfer_fee) = calculate_net_transfer_amount_and_fee(
        token_mint_a_info,
        token_a_delta,
        new_range_token_a_increase_amount,
        is_token_a_transfer_from_owner,
        new_range_token_max_a,
    )?;

    let (token_b_delta, is_token_b_transfer_from_owner) = calculate_token_delta(
        existing_range_token_b_decrease_amount,
        new_range_token_b_increase_amount,
    );
    let (token_b_transfer_amount, token_b_transfer_fee) = calculate_net_transfer_amount_and_fee(
        token_mint_b_info,
        token_b_delta,
        new_range_token_b_increase_amount,
        is_token_b_transfer_from_owner,
        new_range_token_max_b,
    )?;

    // After increase_liquidity, the new position range will have new growth checkpoints,
    // but fees_owed and reward_infos were zeroed during reset. This restores the previous values
    // so that users can still collect previously accumulated fees/rewards.
    position.update_fees_owed(fees_owed_a, fees_owed_b);
    reward_infos
        .iter()
        .enumerate()
        .for_each(|(i, reward_info)| {
            position.update_reward_owed(i, reward_info.amount_owed);
        });

    execute_token_delta_transfers(
        whirlpool_info,
        &whirlpool,
        position_authority_info,
        token_mint_a_info,
        token_vault_a_info,
        token_owner_account_a_info,
        token_program_a_info,
        &remaining_accounts.transfer_hook_a,
        token_a_transfer_amount,
        is_token_a_transfer_from_owner,
        token_mint_b_info,
        token_vault_b_info,
        token_owner_account_b_info,
        token_program_b_info,
        &remaining_accounts.transfer_hook_b,
        memo_program_info,
        token_b_transfer_amount,
        is_token_b_transfer_from_owner,
    )?;

    Event::LiquidityRepositioned {
        whirlpool: whirlpool_info.key(),
        position: position_account_info.key(),
        existing_range_tick_lower_index,
        existing_range_tick_upper_index,
        new_range_tick_lower_index: data.new_tick_lower_index,
        new_range_tick_upper_index: data.new_tick_upper_index,
        existing_range_liquidity,
        new_range_liquidity: new_liquidity_amount,
        existing_range_token_a_amount: existing_range_token_a_decrease_amount,
        existing_range_token_b_amount: existing_range_token_b_decrease_amount,
        new_range_token_a_amount: new_range_token_a_increase_amount,
        new_range_token_b_amount: new_range_token_b_increase_amount,
        token_a_transfer_amount,
        token_a_transfer_fee,
        is_token_a_transfer_from_owner,
        token_b_transfer_amount,
        token_b_transfer_fee,
        is_token_b_transfer_from_owner,
    }
    .emit()?;

    Ok(())
}

fn decrease_liquidity_from_existing_range(
    whirlpool_pubkey: &Pubkey,
    whirlpool: &mut MemoryMappedWhirlpool,
    position: &mut MemoryMappedPosition,
    position_account_info: &AccountInfo,
    existing_tick_array_lower_info: &AccountInfo,
    existing_tick_array_upper_info: &AccountInfo,
    timestamp: u64,
    token_a_amount_out: &mut u64,
    token_b_amount_out: &mut u64,
    fees_owed_a_out: &mut u64,
    fees_owed_b_out: &mut u64,
    reward_infos_out: &mut [PositionRewardInfo; NUM_REWARDS],
) -> Result<()> {
    let position_existing_range_liquidity = position.liquidity();

    let mut tick_arrays = TickArraysMut::load(
        existing_tick_array_lower_info,
        existing_tick_array_upper_info,
        whirlpool_pubkey,
    )?;

    let (lower_tick_array, upper_tick_array) = tick_arrays.deref();
    let (position_update, _whirlpool_reward_growths) = pino_calculate_fee_and_reward_growths(
        whirlpool,
        position,
        lower_tick_array,
        upper_tick_array,
        timestamp,
    )?;

    let existing_range_fees_owed_a = position_update.fee_owed_a;
    let existing_range_fees_owed_b = position_update.fee_owed_b;
    let existing_range_reward_infos = position_update.reward_infos;

    // A position without liquidity can still be repositioned
    if position_existing_range_liquidity == 0 {
        *token_a_amount_out = 0;
        *token_b_amount_out = 0;
        *fees_owed_a_out = existing_range_fees_owed_a;
        *fees_owed_b_out = existing_range_fees_owed_b;
        *reward_infos_out = existing_range_reward_infos;
        return Ok(());
    }

    let liquidity_delta = convert_to_liquidity_delta(position_existing_range_liquidity, false)?;
    let modify_liquidity_update = pino_calculate_modify_liquidity(
        whirlpool,
        position,
        lower_tick_array,
        upper_tick_array,
        liquidity_delta,
        timestamp,
    )?;

    let (lower_tick_array_mut, upper_tick_array_mut) = tick_arrays.deref_mut();
    pino_sync_modify_liquidity_values(
        whirlpool,
        position,
        lower_tick_array_mut,
        upper_tick_array_mut,
        &modify_liquidity_update,
        timestamp,
    )?;

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    pino_update_tick_array_accounts(
        position_account_info,
        existing_tick_array_lower_info,
        existing_tick_array_upper_info,
        &modify_liquidity_update.tick_array_lower_update,
        &modify_liquidity_update.tick_array_upper_update,
    )?;

    let (token_a_delta, token_b_delta) = pino_calculate_liquidity_token_deltas(
        whirlpool.tick_current_index(),
        whirlpool.sqrt_price(),
        position,
        liquidity_delta,
    )?;

    position.reset_fees_owed();
    for i in 0..NUM_REWARDS {
        position.update_reward_owed(i, 0);
    }

    *token_a_amount_out = token_a_delta;
    *token_b_amount_out = token_b_delta;
    *fees_owed_a_out = existing_range_fees_owed_a;
    *fees_owed_b_out = existing_range_fees_owed_b;
    *reward_infos_out = existing_range_reward_infos;

    Ok(())
}

fn increase_liquidity_into_new_range(
    whirlpool_pubkey: &Pubkey,
    whirlpool: &mut MemoryMappedWhirlpool,
    position: &mut MemoryMappedPosition,
    position_account_info: &AccountInfo,
    new_tick_array_lower_info: &AccountInfo,
    new_tick_array_upper_info: &AccountInfo,
    new_range_liquidity: u128,
    timestamp: u64,
) -> Result<(u64, u64)> {
    let liquidity_delta = convert_to_liquidity_delta(new_range_liquidity, true)?;

    let tick_arrays = TickArraysMut::load(
        new_tick_array_lower_info,
        new_tick_array_upper_info,
        whirlpool_pubkey,
    )?;

    let (lower_tick_array, upper_tick_array) = tick_arrays.deref();
    let modify_liquidity_update = pino_calculate_modify_liquidity(
        whirlpool,
        position,
        lower_tick_array,
        upper_tick_array,
        liquidity_delta,
        timestamp,
    )?;

    // Need to drop the tick arrays so we can potentially resize them
    drop(tick_arrays);

    pino_update_tick_array_accounts(
        position_account_info,
        new_tick_array_lower_info,
        new_tick_array_upper_info,
        &modify_liquidity_update.tick_array_lower_update,
        &modify_liquidity_update.tick_array_upper_update,
    )?;

    let mut tick_arrays = TickArraysMut::load(
        new_tick_array_lower_info,
        new_tick_array_upper_info,
        whirlpool_pubkey,
    )?;

    let (lower_tick_array_mut, upper_tick_array_mut) = tick_arrays.deref_mut();
    pino_sync_modify_liquidity_values(
        whirlpool,
        position,
        lower_tick_array_mut,
        upper_tick_array_mut,
        &modify_liquidity_update,
        timestamp,
    )?;

    let (token_a_amount, token_b_amount) = pino_calculate_liquidity_token_deltas(
        whirlpool.tick_current_index(),
        whirlpool.sqrt_price(),
        position,
        liquidity_delta,
    )?;

    Ok((token_a_amount, token_b_amount))
}

fn calculate_token_delta(existing_amount: u64, new_amount: u64) -> (u64, bool) {
    if existing_amount > new_amount {
        (existing_amount - new_amount, false) // User receives tokens
    } else {
        (new_amount - existing_amount, true) // User sends tokens
    }
}

fn execute_token_delta_transfers(
    whirlpool_info: &AccountInfo,
    whirlpool: &MemoryMappedWhirlpool,
    position_authority: &AccountInfo,
    token_mint_a: &AccountInfo,
    token_vault_a: &AccountInfo,
    token_owner_account_a: &AccountInfo,
    token_program_a: &AccountInfo,
    transfer_hook_a_accounts: &Option<Vec<&AccountInfo>>,
    token_a_delta: u64,
    is_token_a_transfer_from_owner: bool,
    token_mint_b: &AccountInfo,
    token_vault_b: &AccountInfo,
    token_owner_account_b: &AccountInfo,
    token_program_b: &AccountInfo,
    transfer_hook_b_accounts: &Option<Vec<&AccountInfo>>,
    memo_program: &AccountInfo,
    token_b_delta: u64,
    is_token_b_transfer_from_owner: bool,
) -> Result<()> {
    if !is_token_a_transfer_from_owner {
        pino_transfer_from_vault_to_owner_v2(
            whirlpool,
            whirlpool_info,
            token_mint_a,
            token_vault_a,
            token_owner_account_a,
            token_program_a,
            memo_program,
            transfer_hook_a_accounts,
            token_a_delta,
            transfer_memo::TRANSFER_MEMO_DECREASE_LIQUIDITY.as_bytes(),
        )?;
    } else {
        pino_transfer_from_owner_to_vault_v2(
            position_authority,
            token_mint_a,
            token_owner_account_a,
            token_vault_a,
            token_program_a,
            memo_program,
            transfer_hook_a_accounts,
            token_a_delta,
        )?;
    }

    if !is_token_b_transfer_from_owner {
        pino_transfer_from_vault_to_owner_v2(
            whirlpool,
            whirlpool_info,
            token_mint_b,
            token_vault_b,
            token_owner_account_b,
            token_program_b,
            memo_program,
            transfer_hook_b_accounts,
            token_b_delta,
            transfer_memo::TRANSFER_MEMO_DECREASE_LIQUIDITY.as_bytes(),
        )?;
    } else {
        pino_transfer_from_owner_to_vault_v2(
            position_authority,
            token_mint_b,
            token_owner_account_b,
            token_vault_b,
            token_program_b,
            memo_program,
            transfer_hook_b_accounts,
            token_b_delta,
        )?;
    }

    Ok(())
}

fn calculate_net_transfer_amount_and_fee(
    token_mint_info: &AccountInfo,
    token_delta: u64,
    new_range_token_increase_amount: u64,
    is_transfer_from_owner: bool,
    token_max: u64,
) -> Result<(u64, u64)> {
    if !is_transfer_from_owner {
        return Ok((token_delta, 0));
    }

    let transfer_fee_included_amount =
        pino_calculate_transfer_fee_included_amount(token_mint_info, token_delta)?;

    assert_new_range_token_increase_under_max(
        new_range_token_increase_amount,
        transfer_fee_included_amount.transfer_fee,
        token_max,
    )?;

    Ok((
        transfer_fee_included_amount.amount,
        transfer_fee_included_amount.transfer_fee,
    ))
}

// For positive transfer deltas from user to vault, enforce new_range_token_max_a and
// new_range_token_max_b against the full new position requirement plus the provided SPL
// transfer fee amount.
fn assert_new_range_token_increase_under_max(
    new_range_amount: u64,
    transfer_fee: u64,
    token_max: u64,
) -> Result<()> {
    let new_range_amount_with_fee = new_range_amount
        .checked_add(transfer_fee)
        .ok_or(WhirlpoolErrorCode::TransferFeeCalculationError)?;

    if new_range_amount_with_fee > token_max {
        pinocchio_log::log!(
            "new amount with fee {} exceeded token max {}",
            new_range_amount_with_fee,
            token_max
        );
        return Err(WhirlpoolErrorCode::TokenMaxExceeded.into());
    }

    Ok(())
}
