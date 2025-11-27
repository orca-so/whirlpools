use crate::{pinocchio::{
    Result, constants::address::{SYSTEM_PROGRAM_ID, WHIRLPOOL_PROGRAM_ID}, errors::WhirlpoolErrorCode, events::Event, ported::{
        manager_liquidity_manager::{
            pino_calculate_liquidity_token_deltas, pino_calculate_modify_liquidity,
            pino_sync_modify_liquidity_values,
        }, manager_tick_array_manager::pino_update_tick_array_accounts, util_remaining_accounts_utils::pino_parse_remaining_accounts, util_shared::pino_verify_position_authority, util_sparse_swap::SparseSwapTickSequenceBuilder, util_token::{
            pino_calculate_transfer_fee_included_amount, pino_transfer_from_owner_to_vault_v2,
        }
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

    let swap_tick_sequence_builder = SparseSwapTickSequenceBuilder::new(
        &tick_array_0_info,
        &tick_array_1_info,
        &tick_array_2_info,
        &remaining_accounts.supplemental_tick_arrays,
    );
    let mut swap_tick_sequence = swap_tick_sequence_builder.try_build(whirlpool_info.key(), whirlpool.tick_current_index(), whirlpool.tick_spacing(), data.a_to_b)?;






    Ok(())
}
