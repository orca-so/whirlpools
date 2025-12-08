use crate::pinocchio::instructions::swap_v2::{PostSwapUpdate, pino_swap};
use crate::pinocchio::ported::util_token::{pino_transfer_from_owner_to_vault, pino_transfer_from_vault_to_owner};
use crate::util::{to_timestamp_u64, AccountsType};
use crate::{
    constants::transfer_memo,
    pinocchio::{
        events::Event,
        ported::{
            util_remaining_accounts_utils::pino_parse_remaining_accounts,
            util_sparse_swap::SparseSwapTickSequenceBuilder,
            util_swap_tick_sequence::SwapTickSequence,
            util_token::{
                pino_calculate_transfer_fee_excluded_amount,
                pino_calculate_transfer_fee_included_amount, pino_transfer_from_owner_to_vault_v2,
                pino_transfer_from_vault_to_owner_v2,
            },
        },
        state::whirlpool::{
            oracle::accessor::OracleAccessor, MemoryMappedTick, MemoryMappedWhirlpool, TickArray,
            TickUpdate,
        },
        utils::{
            account_info_iter::AccountIterator,
            account_load::load_account_mut,
            verify::{verify_address, verify_whirlpool_program_address_seeds},
        },
        Result,
    },
    state::AdaptiveFeeInfo,
};
use pinocchio::account_info::AccountInfo;
use pinocchio::sysvars::{clock::Clock, Sysvar};
use crate::errors::ErrorCode;

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::Swap::try_from_slice(&data[8..])?;

    // account labeling
    let mut iter = AccountIterator::new(accounts);
    let token_program_info = iter.next_program_token()?;
    let token_authority_info = iter.next_signer()?;
    let whirlpool_info = iter.next_mut()?;
    let token_owner_account_a_info = iter.next_mut()?;
    let token_vault_a_info = iter.next_mut()?;
    let token_owner_account_b_info = iter.next_mut()?;
    let token_vault_b_info = iter.next_mut()?;
    let tick_array_0_info = iter.next_mut()?;
    let tick_array_1_info = iter.next_mut()?;
    let tick_array_2_info = iter.next_mut()?;
    let oracle_info = iter.next()?;

    // account validation
    // token_program_info: done
    // token_authority_info: done
    // whirlpool_info
    let mut whirlpool = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_info)?;
    // token_owner_account_a_info: we don't need to verify this account, token program will verify it
    // token_vault_a_info
    verify_address(token_vault_a_info.key(), whirlpool.token_vault_a())?;
    // token_owner_account_b_info: we don't need to verify this account, token program will verify it
    // token_vault_b_info
    verify_address(token_vault_b_info.key(), whirlpool.token_vault_b())?;
    // TODO: tick_array_0_info
    // TODO: tick_array_1_info
    // TODO: tick_array_2_info
    // oracle_info
    verify_whirlpool_program_address_seeds(
        oracle_info.key(),
        &[b"oracle", whirlpool_info.key().as_ref()],
    )?;

    // The beginning of handler core logic

    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let swap_tick_sequence_builder = SparseSwapTickSequenceBuilder::new(
        tick_array_0_info,
        tick_array_1_info,
        tick_array_2_info,
        &None,
    );
    let mut swap_tick_sequence = swap_tick_sequence_builder.try_build(
        whirlpool_info.key(),
        whirlpool.tick_current_index(),
        whirlpool.tick_spacing(),
        data.a_to_b,
    )?;

    let oracle_accessor = OracleAccessor::new(whirlpool_info.key(), oracle_info)?;
    if !oracle_accessor.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info = oracle_accessor.get_adaptive_fee_info()?;

    let swap_update = pino_swap(
        &whirlpool,
        &mut swap_tick_sequence,
        data.amount,
        data.sqrt_price_limit,
        data.amount_specified_is_input,
        data.a_to_b,
        timestamp,
        &adaptive_fee_info,
    )?;

    if data.amount_specified_is_input {
        let output_amount = if data.a_to_b {
            swap_update.amount_b
        } else {
            swap_update.amount_a
        };
        if output_amount < data.other_amount_threshold {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        let input_amount = if data.a_to_b {
            swap_update.amount_a
        } else {
            swap_update.amount_b
        };
        if input_amount > data.other_amount_threshold {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    oracle_accessor.update_adaptive_fee_variables(&swap_update.next_adaptive_fee_info)?;

    let pre_sqrt_price = whirlpool.sqrt_price();
    let (input_amount, output_amount) = if data.a_to_b {
        (swap_update.amount_a, swap_update.amount_b)
    } else {
        (swap_update.amount_b, swap_update.amount_a)
    };
    let (lp_fee, protocol_fee) = (swap_update.lp_fee, swap_update.next_protocol_fee);

    pino_update_and_swap_whirlpool(
        &mut whirlpool,
        whirlpool_info,
        token_authority_info,
        token_owner_account_a_info,
        token_owner_account_b_info,
        token_vault_a_info,
        token_vault_b_info,
        token_program_info,
        &swap_update,
        data.a_to_b,
        timestamp,
    )?;

    Event::Traded {
        whirlpool: whirlpool_info.key(),
        a_to_b: data.a_to_b,
        pre_sqrt_price,
        post_sqrt_price: whirlpool.sqrt_price(),
        input_amount,
        output_amount,
        input_transfer_fee: 0,
        output_transfer_fee: 0,
        lp_fee,
        protocol_fee,
    }
    .emit()?;

    Ok(())
}

// --------------------------------------

// utils/swap_utils.rs

#[allow(clippy::too_many_arguments)]
pub fn pino_update_and_swap_whirlpool(
    whirlpool: &mut MemoryMappedWhirlpool,
    whirlpool_info: &AccountInfo,
    token_authority_info: &AccountInfo,
    token_owner_account_a_info: &AccountInfo,
    token_owner_account_b_info: &AccountInfo,
    token_vault_a_info: &AccountInfo,
    token_vault_b_info: &AccountInfo,
    token_program_info: &AccountInfo,
    swap_update: &PostSwapUpdate,
    is_token_fee_in_a: bool,
    reward_last_updated_timestamp: u64,
) -> Result<()> {
    whirlpool.update_after_swap(
        &swap_update.next_liquidity,
        swap_update.next_tick_index,
        &swap_update.next_sqrt_price,
        &swap_update.next_fee_growth_global,
        &swap_update.next_reward_growths_global,
        swap_update.next_protocol_fee,
        is_token_fee_in_a,
        reward_last_updated_timestamp,
    );

    pino_perform_swap(
        whirlpool,
        whirlpool_info,
        token_authority_info,
        token_owner_account_a_info,
        token_owner_account_b_info,
        token_vault_a_info,
        token_vault_b_info,
        token_program_info,
        swap_update.amount_a,
        swap_update.amount_b,
        is_token_fee_in_a,
    )
}

#[allow(clippy::too_many_arguments)]
fn pino_perform_swap(
    whirlpool: &MemoryMappedWhirlpool,
    whirlpool_info: &AccountInfo,
    token_authority_info: &AccountInfo,
    token_owner_account_a_info: &AccountInfo,
    token_owner_account_b_info: &AccountInfo,
    token_vault_a_info: &AccountInfo,
    token_vault_b_info: &AccountInfo,
    token_program_info: &AccountInfo,
    amount_a: u64,
    amount_b: u64,
    a_to_b: bool,
) -> Result<()> {
    // Transfer from user to pool
    let deposit_account_owner_info;
    let deposit_account_vault_info;
    let deposit_amount;

    // Transfer from pool to user
    let withdrawal_account_owner_info;
    let withdrawal_account_vault_info;
    let withdrawal_amount;

    if a_to_b {
        deposit_account_owner_info = token_owner_account_a_info;
        deposit_account_vault_info = token_vault_a_info;
        deposit_amount = amount_a;

        withdrawal_account_owner_info = token_owner_account_b_info;
        withdrawal_account_vault_info = token_vault_b_info;
        withdrawal_amount = amount_b;
    } else {
        deposit_account_owner_info = token_owner_account_b_info;
        deposit_account_vault_info = token_vault_b_info;
        deposit_amount = amount_b;

        withdrawal_account_owner_info = token_owner_account_a_info;
        withdrawal_account_vault_info = token_vault_a_info;
        withdrawal_amount = amount_a;
    }

    pino_transfer_from_owner_to_vault(
        token_authority_info,
        deposit_account_owner_info,
        deposit_account_vault_info,
        token_program_info,
        deposit_amount,
    )?;

    pino_transfer_from_vault_to_owner(
        whirlpool,
        whirlpool_info,
        withdrawal_account_vault_info,
        withdrawal_account_owner_info,
        token_program_info,
        withdrawal_amount,
    )?;

    Ok(())
}
