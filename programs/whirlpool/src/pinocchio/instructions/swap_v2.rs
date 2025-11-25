use crate::{pinocchio::{
    Result, constants::address::{SYSTEM_PROGRAM_ID, WHIRLPOOL_PROGRAM_ID}, errors::WhirlpoolErrorCode, events::Event, ported::{
        manager_liquidity_manager::{
            pino_calculate_liquidity_token_deltas, pino_calculate_modify_liquidity,
            pino_sync_modify_liquidity_values,
        },
        manager_tick_array_manager::pino_update_tick_array_accounts,
        util_remaining_accounts_utils::pino_parse_remaining_accounts,
        util_shared::pino_verify_position_authority,
        util_token::{
            pino_calculate_transfer_fee_included_amount, pino_transfer_from_owner_to_vault_v2,
        },
    }, state::{
        token::MemoryMappedTokenAccount,
        whirlpool::{
            MemoryMappedPosition, MemoryMappedTick, MemoryMappedWhirlpool, TickArray, TickUpdate, loader::{LoadedTickArrayMut, load_tick_array_mut}, proxy::ProxiedTickArray, tick_array::loader::TickArraysMut, zeroed_tick_array::MemoryMappedZeroedTickArray
        },
    }, utils::{
        account_info_iter::AccountIterator,
        account_load::{load_account_mut, load_token_program_account},
        verify::{verify_address, verify_constraint},
    }
}, util::{SwapTickSequence, get_start_tick_indexes}};
use crate::{
    math::convert_to_liquidity_delta,
    util::{to_timestamp_u64, AccountsType},
};
use arrayvec::ArrayVec;
use pinocchio::{account_info::AccountInfo, pubkey::{Pubkey, find_program_address, pubkey_eq}};
use pinocchio::sysvars::{clock::Clock, Sysvar};

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::SwapV2::try_from_slice(&data[8..])?;

    // account labeling
    let mut iter = AccountIterator::new(accounts);
    let token_program_a_info = iter.next_program_token_or_token_2022()?;
    let token_program_b_info = iter.next_program_token_or_token_2022()?;
    let memo_program_info = iter.next_program_memo()?;
    let token_authority_info = iter.next_signer()?;
    let whirlpool_info = iter.next_mut()?;
    let token_mint_a_info = iter.next()?;
    let token_mint_b_info = iter.next()?;
    let token_owner_account_a_info = iter.next_mut()?;
    let token_vault_a_info = iter.next_mut()?;
    let token_owner_account_b_info = iter.next_mut()?;
    let token_vault_b_info = iter.next_mut()?;
    let tick_array_0_info = iter.next_mut()?;
    let tick_array_1_info = iter.next_mut()?;
    let tick_array_2_info = iter.next_mut()?;
    let oracle_info = iter.next_mut()?;
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
    // - supplemental TickArray accounts
    let remaining_accounts = iter.remaining_accounts();

    // account validation
    // token_program_a_info
    verify_address(token_program_a_info.key(), token_mint_a_info.owner())?;
    // token_program_b_info
    verify_address(token_program_b_info.key(), token_mint_b_info.owner())?;
    // memo_program_info: done
    // token_authority_info: done
    // whirlpool_info
    let mut whirlpool = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_info)?;
    // token_mint_a_info
    verify_address(token_mint_a_info.key(), whirlpool.token_mint_a())?;
    // token_mint_b_info
    verify_address(token_mint_b_info.key(), whirlpool.token_mint_b())?;
    // token_owner_account_a_info: we don't need to verify this account, token program will verify it
    // token_vault_a_info
    verify_address(token_vault_a_info.key(), whirlpool.token_vault_a())?;
    // token_owner_account_b_info: we don't need to verify this account, token program will verify it
    // token_vault_b_info
    verify_address(token_vault_b_info.key(), whirlpool.token_vault_b())?;
    // TODO: tick_array_0_info
    // TODO: tick_array_1_info
    // TODO: tick_array_2_info
    // TODO: oracle_info

    // The beginning of handler core logic

    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    // Process remaining accounts
    let remaining_accounts = pino_parse_remaining_accounts(
        remaining_accounts,
        &data.remaining_accounts_info,
        &[AccountsType::TransferHookA, AccountsType::TransferHookB, AccountsType::SupplementalTickArrays],
    )?;

    let swap_tick_sequence = build_swap_tick_sequence(
        whirlpool_info,
        &whirlpool,
        data.a_to_b,
        tick_array_0_info,
        tick_array_1_info,
        tick_array_2_info,
        &remaining_accounts.supplemental_tick_arrays,
    )?;





    Ok(())
}

// TODO: rename
const MAX_TICK_ARRAY_INFOS_LEN: usize = 3 + crate::util::MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN;
const MAX_LOADED_TICK_ARRAYS_LEN: usize = 3;

fn build_swap_tick_sequence(
    whirlpool_info: &AccountInfo,
    whirlpool: &MemoryMappedWhirlpool,
    a_to_b: bool,
    tick_array_0_info: &AccountInfo,
    tick_array_1_info: &AccountInfo,
    tick_array_2_info: &AccountInfo,
    supplemental_tick_arrays: &[AccountInfo],
) -> Result<Vec<TickArraysMut>> {
    let mut all_tick_array_infos: ArrayVec<&AccountInfo, MAX_TICK_ARRAY_INFOS_LEN> = ArrayVec::new();

    all_tick_array_infos.push(tick_array_0_info);
    all_tick_array_infos.push(tick_array_1_info);
    all_tick_array_infos.push(tick_array_2_info);
    all_tick_array_infos.extend(supplemental_tick_arrays.iter());

    // dedup by key
    all_tick_array_infos.sort_by_key(|info| info.key());
    let mut tick_array_infos: ArrayVec<&AccountInfo, MAX_TICK_ARRAY_INFOS_LEN> = ArrayVec::new();
    tick_array_infos.push(all_tick_array_infos[0]);
    for info in all_tick_array_infos.iter().skip(1) {
        if !pubkey_eq(info.key(), tick_array_infos.last().unwrap().key()) {
            tick_array_infos.push(info);
        }
    }

    let mut loaded_tick_arrays: ArrayVec<LoadedTickArrayMut, MAX_LOADED_TICK_ARRAYS_LEN> = ArrayVec::new();
    for tick_array_info in tick_array_infos.iter() {
        if let Some(loaded_tick_array) =
            pino_maybe_load_tick_array(tick_array_info, whirlpool_info.key())?
        {
            loaded_tick_arrays.push(loaded_tick_array);
        }
    }

    let start_tick_indexes = get_start_tick_indexes(whirlpool.tick_current_index(), whirlpool.tick_spacing(), a_to_b);
    let mut required_tick_arrays: ArrayVec<ProxiedTickArray, 3> = ArrayVec::new();
    for start_tick_index in start_tick_indexes.iter() {
        let pos = loaded_tick_arrays
            .iter()
            .position(|tick_array| tick_array.start_tick_index() == *start_tick_index);
        if let Some(pos) = pos {
            let tick_array = loaded_tick_arrays.remove(pos);
            required_tick_arrays.push(ProxiedTickArray::new_initialized(tick_array));
            continue;
        }

        let tick_array_pda = pino_derive_tick_array_pda(whirlpool_info.key(), *start_tick_index);
        let has_account_info = tick_array_infos
            .iter()
            .any(|account_info| pubkey_eq(account_info.key(), &tick_array_pda));
        if has_account_info {
            required_tick_arrays
                .push(ProxiedTickArray::new_uninitialized(*start_tick_index));
            continue;
        }
        break;
    }

    if required_tick_arrays.is_empty() {
        return Err(WhirlpoolErrorCode::InvalidTickArraySequence.into());
    }

    Ok(SwapTickSequence::new_with_proxy(
        required_tick_arrays.pop().unwrap(),
        required_tick_arrays.pop(),
        required_tick_arrays.pop(),
    ))
}

fn pino_derive_tick_array_pda(whirlpool_key: &Pubkey, start_tick_index: i32) -> Pubkey {
    find_program_address(
    &[
        b"tick_array",
        whirlpool_key.as_ref(),
        start_tick_index.to_string().as_bytes(),
    ],
    &WHIRLPOOL_PROGRAM_ID).0
}

fn pino_maybe_load_tick_array<'a>(
    account_info: &'a AccountInfo,
    whirlpool_key: &Pubkey,
) -> Result<Option<LoadedTickArrayMut<'a>>> {
    if account_info.is_owned_by(&SYSTEM_PROGRAM_ID) && account_info.data_is_empty() {
        return Ok(None);
    }

    let tick_array = load_tick_array_mut(account_info, whirlpool_key)?;
    Ok(Some(tick_array))
}

