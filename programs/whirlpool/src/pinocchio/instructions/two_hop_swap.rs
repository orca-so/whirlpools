use crate::pinocchio::instructions::swap::pino_update_and_swap_whirlpool;
use crate::pinocchio::instructions::swap_v2::{
    PostSwapUpdate, pino_swap, pino_swap_with_transfer_fee_extension
};
use crate::util::{to_timestamp_u64, AccountsType};
use crate::{
    constants::transfer_memo,
    pinocchio::{
        events::Event,
        ported::{
            util_remaining_accounts_utils::pino_parse_remaining_accounts,
            util_sparse_swap::SparseSwapTickSequenceBuilder,
            util_token::{
                pino_calculate_transfer_fee_excluded_amount, pino_transfer_from_owner_to_vault_v2,
                pino_transfer_from_vault_to_owner_v2,
            },
        },
        state::whirlpool::{oracle::accessor::OracleAccessor, MemoryMappedWhirlpool},
        utils::{
            account_info_iter::AccountIterator,
            account_load::load_account_mut,
            verify::{verify_address, verify_whirlpool_program_address_seeds},
        },
        Result,
    },
};
use pinocchio::account_info::AccountInfo;
use pinocchio::pubkey::pubkey_eq;
use pinocchio::sysvars::{clock::Clock, Sysvar};

use crate::errors::ErrorCode;

/*
#[derive(Accounts)]
pub struct TwoHopSwap<'info> {
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    pub token_authority: Signer<'info>,

    #[account(mut)]
    pub whirlpool_one: Box<Account<'info, Whirlpool>>,

    #[account(mut)]
    pub whirlpool_two: Box<Account<'info, Whirlpool>>,

    #[account(mut, constraint = token_owner_account_one_a.mint == whirlpool_one.token_mint_a)]
    pub token_owner_account_one_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_one.token_vault_a)]
    pub token_vault_one_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_one_b.mint == whirlpool_one.token_mint_b)]
    pub token_owner_account_one_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_one.token_vault_b)]
    pub token_vault_one_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_two_a.mint == whirlpool_two.token_mint_a)]
    pub token_owner_account_two_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_two.token_vault_a)]
    pub token_vault_two_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_two_b.mint == whirlpool_two.token_mint_b)]
    pub token_owner_account_two_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_two.token_vault_b)]
    pub token_vault_two_b: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_one_0: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_one_1: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_one_2: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_two_0: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_two_1: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_two_2: UncheckedAccount<'info>,

    #[account(seeds = [b"oracle", whirlpool_one.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_one: UncheckedAccount<'info>,

    #[account(seeds = [b"oracle", whirlpool_two.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_two: UncheckedAccount<'info>,
    // Special notes to support pools with AdaptiveFee:
    // - For trades on pools using AdaptiveFee, pass oracle_one and oracle_two as writable accounts in the remaining accounts.
    // - If you want to avoid using the remaining accounts, you can pass oracle_one and oracle_two as writable accounts directly.

    // remaining accounts
    // - [mut] oracle_one
    // - [mut] oracle_two
}
*/

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::TwoHopSwap::try_from_slice(&data[8..])?;

    // account labeling
    let mut iter = AccountIterator::new(accounts);
    let token_program_info = iter.next_program_token()?;
    let token_authority_info = iter.next_signer()?;
    let whirlpool_one_info = iter.next_mut()?;
    let whirlpool_two_info = iter.next_mut()?;
    let token_owner_account_one_a_info = iter.next_mut()?;
    let token_vault_one_a_info = iter.next_mut()?;
    let token_owner_account_one_b_info = iter.next_mut()?;
    let token_vault_one_b_info = iter.next_mut()?;
    let token_owner_account_two_a_info = iter.next_mut()?;
    let token_vault_two_a_info = iter.next_mut()?;
    let token_owner_account_two_b_info = iter.next_mut()?;
    let token_vault_two_b_info = iter.next_mut()?;
    let tick_array_one_0_info = iter.next_mut()?;
    let tick_array_one_1_info = iter.next_mut()?;
    let tick_array_one_2_info = iter.next_mut()?;
    let tick_array_two_0_info = iter.next_mut()?;
    let tick_array_two_1_info = iter.next_mut()?;
    let tick_array_two_2_info = iter.next_mut()?;
    let oracle_one_info = iter.next()?;
    let oracle_two_info = iter.next()?;
    // Special notes to support pools with AdaptiveFee:
    // - For trades on pools using AdaptiveFee, pass oracle_one and oracle_two as writable accounts in the remaining accounts.
    // - If you want to avoid using the remaining accounts, you can pass oracle_one and oracle_two as writable accounts directly.

    // remaining accounts
    // - [mut] oracle_one
    // - [mut] oracle_two

    // account validation
    // token_program_info: done
    // token_authority_info: done
    // whirlpool_one_info
    let mut whirlpool_one = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_one_info)?;
    // whirlpool_two_info
    // Don't allow swaps on the same whirlpool
    // load_account_mut will throw AccountBorrowFailed if both accounts are the same.
    if pubkey_eq(whirlpool_one_info.key(), whirlpool_two_info.key()) {
        return Err(ErrorCode::DuplicateTwoHopPool.into());
    }
    let mut whirlpool_two = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_two_info)?;
    // token_owner_account_one_a_info: we don't need to verify this account, token program will verify it
    // token_vault_one_a_info
    verify_address(
        token_vault_one_a_info.key(),
        whirlpool_one.token_vault_a(),
    )?;
    // token_owner_account_one_b_info: we don't need to verify this account, token program will verify it
    // token_vault_one_b_info
    verify_address(
        token_vault_one_b_info.key(),
        whirlpool_one.token_vault_b(),
    )?;
    // token_owner_account_two_a_info: we don't need to verify this account, token program will verify it
    // token_vault_two_a_info
    verify_address(
        token_vault_two_a_info.key(),
        whirlpool_two.token_vault_a(),
    )?;
    // token_owner_account_two_b_info: we don't need to verify this account, token program will verify it
    // token_vault_two_b_info
    verify_address(
        token_vault_two_b_info.key(),
        whirlpool_two.token_vault_b(),
    )?;
    // TODO: tick_array_one_0_info
    // TODO: tick_array_one_1_info
    // TODO: tick_array_one_2_info
    // TODO: tick_array_two_0_info
    // TODO: tick_array_two_1_info
    // TODO: tick_array_two_2_info
    // oracle_one_info
    verify_whirlpool_program_address_seeds(
        oracle_one_info.key(),
        &[b"oracle", whirlpool_one_info.key().as_ref()],
    )?;
    // oracle_two_info
    verify_whirlpool_program_address_seeds(
        oracle_two_info.key(),
        &[b"oracle", whirlpool_two_info.key().as_ref()],
    )?;

    // The beginning of handler core logic

    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let swap_one_output_mint = whirlpool_one.output_token_mint(data.a_to_b_one);
    let swap_two_input_mint = whirlpool_two.input_token_mint(data.a_to_b_two);
    if !pubkey_eq(swap_one_output_mint, swap_two_input_mint) {
        return Err(ErrorCode::InvalidIntermediaryMint.into());
    }

    let swap_tick_sequence_builder_one = SparseSwapTickSequenceBuilder::new(
        tick_array_one_0_info,
        tick_array_one_1_info,
        tick_array_one_2_info,
        &None,
    );
    let mut swap_tick_sequence_one = swap_tick_sequence_builder_one.try_build(
        whirlpool_one_info.key(),
        whirlpool_one.tick_current_index(),
        whirlpool_one.tick_spacing(),
        data.a_to_b_one,
    )?;

    let swap_tick_sequence_builder_two = SparseSwapTickSequenceBuilder::new(
        tick_array_two_0_info,
        tick_array_two_1_info,
        tick_array_two_2_info,
        &None,
    );
    let mut swap_tick_sequence_two = swap_tick_sequence_builder_two.try_build(
        whirlpool_two_info.key(),
        whirlpool_two.tick_current_index(),
        whirlpool_two.tick_spacing(),
        data.a_to_b_two,
    )?;

    let oracle_accessor_one = OracleAccessor::new(whirlpool_one_info.key(), oracle_one_info)?;
    if !oracle_accessor_one.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info_one = oracle_accessor_one.get_adaptive_fee_info()?;

    let oracle_accessor_two = OracleAccessor::new(whirlpool_two_info.key(), oracle_two_info)?;
    if !oracle_accessor_two.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info_two = oracle_accessor_two.get_adaptive_fee_info()?;

    let (swap_update_one, swap_update_two) = if data.amount_specified_is_input {
        // If the amount specified is input, this means we are doing exact-in
        // and the swap calculations occur from Swap 1 => Swap 2
        // and the swaps occur from Swap 1 => Swap 2
        let swap_calc_one = pino_swap(
            &whirlpool_one,
            &mut swap_tick_sequence_one,
            data.amount,
            data.sqrt_price_limit_one,
            data.amount_specified_is_input, // true
            data.a_to_b_one,
            timestamp,
            &adaptive_fee_info_one,
        )?;

        // Swap two input is the output of swap one
        // We use vault to vault transfer, so transfer fee will be collected once.
        let swap_two_input_amount = if data.a_to_b_one {
            swap_calc_one.amount_b
        } else {
            swap_calc_one.amount_a
        };

        let swap_calc_two = pino_swap(
            &whirlpool_two,
            &mut swap_tick_sequence_two,
            swap_two_input_amount,
            data.sqrt_price_limit_two,
            data.amount_specified_is_input, // true
            data.a_to_b_two,
            timestamp,
            &adaptive_fee_info_two,
        )?;
        (swap_calc_one, swap_calc_two)
    } else {
        // If the amount specified is output, this means we need to invert the ordering of the calculations
        // and the swap calculations occur from Swap 2 => Swap 1
        // but the actual swaps occur from Swap 1 => Swap 2 (to ensure that the intermediate token exists in the account)
        let swap_calc_two = pino_swap(
            &whirlpool_two,
            &mut swap_tick_sequence_two,
            data.amount,
            data.sqrt_price_limit_two,
            data.amount_specified_is_input, // false
            data.a_to_b_two,
            timestamp,
            &adaptive_fee_info_two,
        )?;

        // The output of swap 1 is input of swap_calc_two
        let swap_one_output_amount = if data.a_to_b_two {
            swap_calc_two.amount_a
        } else {
            swap_calc_two.amount_b
        };

        let swap_calc_one = pino_swap(
            &whirlpool_one,
            &mut swap_tick_sequence_one,
            swap_one_output_amount,
            data.sqrt_price_limit_one,
            data.amount_specified_is_input, // false
            data.a_to_b_one,
            timestamp,
            &adaptive_fee_info_one,
        )?;
        (swap_calc_one, swap_calc_two)
    };

    // All output token should be consumed by the second swap
    let swap_calc_one_output = if data.a_to_b_one {
        swap_update_one.amount_b
    } else {
        swap_update_one.amount_a
    };
    let swap_calc_two_input = if data.a_to_b_two {
        swap_update_two.amount_a
    } else {
        swap_update_two.amount_b
    };
    if swap_calc_one_output != swap_calc_two_input {
        return Err(ErrorCode::IntermediateTokenAmountMismatch.into());
    }

    if data.amount_specified_is_input {
        // If amount_specified_is_input == true, then we have a variable amount of output
        // The slippage we care about is the output of the second swap.
        let output_amount = if data.a_to_b_two {
            swap_update_two.amount_b
        } else {
            swap_update_two.amount_a
        };

        // If we have received less than the minimum out, throw an error
        if output_amount < data.other_amount_threshold {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        // amount_specified_is_output == false, then we have a variable amount of input
        // The slippage we care about is the input of the first swap
        let input_amount = if data.a_to_b_one {
            swap_update_one.amount_a
        } else {
            swap_update_one.amount_b
        };
        if input_amount > data.other_amount_threshold {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    oracle_accessor_one.update_adaptive_fee_variables(&swap_update_one.next_adaptive_fee_info)?;

    oracle_accessor_two.update_adaptive_fee_variables(&swap_update_two.next_adaptive_fee_info)?;

    let pre_sqrt_price_one = whirlpool_one.sqrt_price();
    let (input_amount_one, output_amount_one) = if data.a_to_b_one {
        (swap_update_one.amount_a, swap_update_one.amount_b)
    } else {
        (swap_update_one.amount_b, swap_update_one.amount_a)
    };
    let (lp_fee_one, protocol_fee_one) =
        (swap_update_one.lp_fee, swap_update_one.next_protocol_fee);

    pino_update_and_swap_whirlpool(
        &mut whirlpool_one,
        whirlpool_one_info,
        token_authority_info,
        token_owner_account_one_a_info,
        token_owner_account_one_b_info,
        token_vault_one_a_info,
        token_vault_one_b_info,
        token_program_info,
        &swap_update_one,
        data.a_to_b_one,
        timestamp,
    )?;

    let pre_sqrt_price_two = whirlpool_two.sqrt_price();
    let (input_amount_two, output_amount_two) = if data.a_to_b_two {
        (swap_update_two.amount_a, swap_update_two.amount_b)
    } else {
        (swap_update_two.amount_b, swap_update_two.amount_a)
    };
    let (lp_fee_two, protocol_fee_two) =
        (swap_update_two.lp_fee, swap_update_two.next_protocol_fee);

    pino_update_and_swap_whirlpool(
        &mut whirlpool_two,
        whirlpool_two_info,
        token_authority_info,
        token_owner_account_two_a_info,
        token_owner_account_two_b_info,
        token_vault_two_a_info,
        token_vault_two_b_info,
        token_program_info,
        &swap_update_two,
        data.a_to_b_two,
        timestamp,
    )?;

    Event::Traded {
        whirlpool: whirlpool_one_info.key(),
        a_to_b: data.a_to_b_one,
        pre_sqrt_price: pre_sqrt_price_one,
        post_sqrt_price: whirlpool_one.sqrt_price(),
        input_amount: input_amount_one,
        output_amount: output_amount_one,
        input_transfer_fee: 0,
        output_transfer_fee: 0,
        lp_fee: lp_fee_one,
        protocol_fee: protocol_fee_one,
    }
    .emit()?;

    Event::Traded {
        whirlpool: whirlpool_two_info.key(),
        a_to_b: data.a_to_b_two,
        pre_sqrt_price: pre_sqrt_price_two,
        post_sqrt_price: whirlpool_two.sqrt_price(),
        input_amount: input_amount_two,
        output_amount: output_amount_two,
        input_transfer_fee: 0,
        output_transfer_fee: 0,
        lp_fee: lp_fee_two,
        protocol_fee: protocol_fee_two,
    }
    .emit()?;

    Ok(())
}

// ----------------------------------------
