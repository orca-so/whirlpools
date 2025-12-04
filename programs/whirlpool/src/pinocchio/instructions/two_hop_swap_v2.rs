use crate::pinocchio::instructions::swap_v2::{PostSwapUpdate, pino_swap_with_transfer_fee_extension};
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
use pinocchio::pubkey::pubkey_eq;
use pinocchio::sysvars::{clock::Clock, Sysvar};

use crate::errors::ErrorCode;


/* 
#[derive(Accounts)]
#[instruction(
    amount: u64,
    other_amount_threshold: u64,
    amount_specified_is_input: bool,
    a_to_b_one: bool,
    a_to_b_two: bool,
)]
pub struct TwoHopSwapV2<'info> {
    #[account(mut)]
    pub whirlpool_one: Box<Account<'info, Whirlpool>>,
    #[account(mut)]
    pub whirlpool_two: Box<Account<'info, Whirlpool>>,

    #[account(address = whirlpool_one.input_token_mint(a_to_b_one))]
    pub token_mint_input: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool_one.output_token_mint(a_to_b_one))]
    pub token_mint_intermediate: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool_two.output_token_mint(a_to_b_two))]
    pub token_mint_output: InterfaceAccount<'info, Mint>,

    #[account(address = *token_mint_input.to_account_info().owner)]
    pub token_program_input: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_intermediate.to_account_info().owner)]
    pub token_program_intermediate: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_output.to_account_info().owner)]
    pub token_program_output: Interface<'info, TokenInterface>,

    #[account(mut, constraint = token_owner_account_input.mint == token_mint_input.key())]
    pub token_owner_account_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_one.input_token_vault(a_to_b_one))]
    pub token_vault_one_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_one.output_token_vault(a_to_b_one))]
    pub token_vault_one_intermediate: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = whirlpool_two.input_token_vault(a_to_b_two))]
    pub token_vault_two_intermediate: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_two.output_token_vault(a_to_b_two))]
    pub token_vault_two_output: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_owner_account_output.mint == token_mint_output.key())]
    pub token_owner_account_output: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_authority: Signer<'info>,

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

    #[account(mut, seeds = [b"oracle", whirlpool_one.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_one: UncheckedAccount<'info>,

    #[account(mut, seeds = [b"oracle", whirlpool_two.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_two: UncheckedAccount<'info>,

    pub memo_program: Program<'info, Memo>,
    // remaining accounts
    // - accounts for transfer hook program of token_mint_input
    // - accounts for transfer hook program of token_mint_intermediate
    // - accounts for transfer hook program of token_mint_output
    // - supplemental TickArray accounts for whirlpool_one
    // - supplemental TickArray accounts for whirlpool_two
}
*/

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::TwoHopSwapV2::try_from_slice(&data[8..])?;

    // account labeling
    let mut iter = AccountIterator::new(accounts);
    let whirlpool_one_info = iter.next_mut()?;
    let whirlpool_two_info = iter.next_mut()?;
    let token_mint_input_info = iter.next()?;
    let token_mint_intermediate_info = iter.next()?;
    let token_mint_output_info = iter.next()?;
    let token_program_input_info = iter.next_program_token_or_token_2022()?;
    let token_program_intermediate_info = iter.next_program_token_or_token_2022()?;
    let token_program_output_info = iter.next_program_token_or_token_2022()?;
    let token_owner_account_input_info = iter.next_mut()?;
    let token_vault_one_input_info = iter.next_mut()?;
    let token_vault_one_intermediate_info = iter.next_mut()?;
    let token_vault_two_intermediate_info = iter.next_mut()?;
    let token_vault_two_output_info = iter.next_mut()?;
    let token_owner_account_output_info = iter.next_mut()?;
    let token_authority_info = iter.next_signer()?;
    let tick_array_one_0_info = iter.next_mut()?;
    let tick_array_one_1_info = iter.next_mut()?;
    let tick_array_one_2_info = iter.next_mut()?;
    let tick_array_two_0_info = iter.next_mut()?;
    let tick_array_two_1_info = iter.next_mut()?;
    let tick_array_two_2_info = iter.next_mut()?;
    let memo_program_info = iter.next_program_memo()?;
    let oracle_one_info = iter.next_mut()?;
    let oracle_two_info = iter.next_mut()?;
    // remaining accounts
    // - accounts for transfer hook program of token_mint_input
    // - accounts for transfer hook program of token_mint_intermediate
    // - accounts for transfer hook program of token_mint_output
    // - supplemental TickArray accounts for whirlpool_one
    // - supplemental TickArray accounts for whirlpool_two
    let remaining_accounts = iter.remaining_accounts();

    // account validation
    // whirlpool_one_info
    let mut whirlpool_one = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_one_info)?;
    // whirlpool_two_info
    let mut whirlpool_two = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_two_info)?;
    // token_mint_input_info
    verify_address(
        token_mint_input_info.key(),
        whirlpool_one.input_token_mint(data.a_to_b_one),
    )?;
    // token_mint_intermediate_info
    verify_address(
        token_mint_intermediate_info.key(),
        whirlpool_one.output_token_mint(data.a_to_b_one),
    )?;
    // token_mint_output_info
    verify_address(
        token_mint_output_info.key(),
        whirlpool_two.output_token_mint(data.a_to_b_two),
    )?;
    // token_program_input_info
    verify_address(
        token_program_input_info.key(),
        token_mint_input_info.owner(),
    )?;
    // token_program_intermediate_info
    verify_address(
        token_program_intermediate_info.key(),
        token_mint_intermediate_info.owner(),
    )?;
    // token_program_output_info
    verify_address(
        token_program_output_info.key(),
        token_mint_output_info.owner(),
    )?;
    // token_owner_account_input_info: we don't need to verify this account, token program will verify it
    // token_vault_one_input_info
    verify_address(
        token_vault_one_input_info.key(),
        whirlpool_one.input_token_vault(data.a_to_b_one),
    )?;
    // token_vault_one_intermediate_info
    verify_address(
        token_vault_one_intermediate_info.key(),
        whirlpool_one.output_token_vault(data.a_to_b_one),
    )?;
    // token_vault_two_intermediate_info
    verify_address(
        token_vault_two_intermediate_info.key(),
        whirlpool_two.input_token_vault(data.a_to_b_two),
    )?;
    // token_vault_two_output_info
    verify_address(
        token_vault_two_output_info.key(),
        whirlpool_two.output_token_vault(data.a_to_b_two),
    )?;
    // token_owner_account_output_info: we don't need to verify this account, token program will verify it
    // token_authority_info: done
    // TODO: tick_array_one_0_info
    // TODO: tick_array_one_1_info
    // TODO: tick_array_one_2_info
    // TODO: tick_array_two_0_info
    // TODO: tick_array_two_1_info
    // TODO: tick_array_two_2_info
    // oracle_one_info
    verify_whirlpool_program_address_seeds(oracle_one_info.key(),
    &[
        b"oracle",
        whirlpool_one_info.key().as_ref(),
    ],
  )?;
    // oracle_two_info
    verify_whirlpool_program_address_seeds(oracle_two_info.key(),
    &[
        b"oracle",
        whirlpool_two_info.key().as_ref(),
    ],
  )?;
  // memo_program_info: done

    // The beginning of handler core logic

    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    // TODO: load_mut for the same Whirlpool ... different error ?

    // Don't allow swaps on the same whirlpool
    if pubkey_eq(whirlpool_one_info.key(), whirlpool_two_info.key()) {
        return Err(ErrorCode::DuplicateTwoHopPool.into());
    }

    let swap_one_output_mint = whirlpool_one.output_token_mint(data.a_to_b_one);
    let swap_two_input_mint = whirlpool_two.input_token_mint(data.a_to_b_two);
    if !pubkey_eq(swap_one_output_mint, swap_two_input_mint) {
        return Err(ErrorCode::InvalidIntermediaryMint.into());
    }

    // Process remaining accounts
    let remaining_accounts = pino_parse_remaining_accounts(
        remaining_accounts,
        &data.remaining_accounts_info,
        &[
            AccountsType::TransferHookInput,
            AccountsType::TransferHookIntermediate,
            AccountsType::TransferHookOutput,
            AccountsType::SupplementalTickArraysOne,
            AccountsType::SupplementalTickArraysTwo,
        ],
    )?;

    let swap_tick_sequence_builder_one = SparseSwapTickSequenceBuilder::new(
        tick_array_one_0_info,
        tick_array_one_1_info,
        tick_array_one_2_info,
        &remaining_accounts.supplemental_tick_arrays_one,
    );
    let mut swap_tick_sequence_one = swap_tick_sequence_builder_one.try_build(whirlpool_one_info.key(), whirlpool_one.tick_current_index(), whirlpool_one.tick_spacing(), data.a_to_b_one)?;

    let swap_tick_sequence_builder_two = SparseSwapTickSequenceBuilder::new(
        tick_array_two_0_info,
        tick_array_two_1_info,
        tick_array_two_2_info,
        &remaining_accounts.supplemental_tick_arrays_two,
    );
    let mut swap_tick_sequence_two = swap_tick_sequence_builder_two.try_build(whirlpool_two_info.key(), whirlpool_two.tick_current_index(), whirlpool_two.tick_spacing(), data.a_to_b_two)?;

    let oracle_accessor_one =
        OracleAccessor::new(whirlpool_one_info.key(), oracle_one_info)?;
    if !oracle_accessor_one.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info_one = oracle_accessor_one.get_adaptive_fee_info()?;

    let oracle_accessor_two =
        OracleAccessor::new(whirlpool_two_info.key(), oracle_two_info)?;
    if !oracle_accessor_two.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info_two = oracle_accessor_two.get_adaptive_fee_info()?;

    let (swap_update_one, swap_update_two) = if data.amount_specified_is_input {
        // If the amount specified is input, this means we are doing exact-in
        // and the swap calculations occur from Swap 1 => Swap 2
        // and the swaps occur from Swap 1 => Swap 2
        let swap_calc_one = pino_swap_with_transfer_fee_extension(
            &whirlpool_one,
            if data.a_to_b_one {
                token_mint_input_info
            } else {
                token_mint_intermediate_info
            },
            if data.a_to_b_one {
                token_mint_intermediate_info
            } else {
                token_mint_input_info
            },
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

        let swap_calc_two = pino_swap_with_transfer_fee_extension(
            &whirlpool_two,
            if data.a_to_b_two {
                token_mint_intermediate_info
            } else {
                token_mint_output_info
            },
            if data.a_to_b_two {
                token_mint_output_info
            } else {
                token_mint_intermediate_info
            },
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
        let swap_calc_two = pino_swap_with_transfer_fee_extension(
            &whirlpool_two,
            if data.a_to_b_two {
                token_mint_intermediate_info
            } else {
                token_mint_output_info
            },
            if data.a_to_b_two {
                token_mint_output_info
            } else {
                token_mint_intermediate_info
            },
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
            pino_calculate_transfer_fee_excluded_amount(
                token_mint_intermediate_info,
                swap_calc_two.amount_a,
            )?
            .amount
        } else {
            pino_calculate_transfer_fee_excluded_amount(
                token_mint_intermediate_info,
                swap_calc_two.amount_b,
            )?
            .amount
        };

        let swap_calc_one = pino_swap_with_transfer_fee_extension(
            &whirlpool_one,
            if data.a_to_b_one {
                token_mint_input_info
            } else {
                token_mint_intermediate_info
            },
            if data.a_to_b_one {
                token_mint_intermediate_info
            } else {
                token_mint_input_info
            },
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
            pino_calculate_transfer_fee_excluded_amount(
                token_mint_output_info,
                swap_update_two.amount_b,
            )?
            .amount
        } else {
            pino_calculate_transfer_fee_excluded_amount(
                token_mint_output_info,
                swap_update_two.amount_a,
            )?
            .amount
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
    let input_transfer_fee_one =
        pino_calculate_transfer_fee_excluded_amount(token_mint_input_info, input_amount_one)?
            .transfer_fee;
    let output_transfer_fee_one = pino_calculate_transfer_fee_excluded_amount(
        token_mint_intermediate_info,
        output_amount_one,
    )?
    .transfer_fee;
    let (lp_fee_one, protocol_fee_one) =
        (swap_update_one.lp_fee, swap_update_one.next_protocol_fee);

    let pre_sqrt_price_two = whirlpool_two.sqrt_price();
    let (input_amount_two, output_amount_two) = if data.a_to_b_two {
        (swap_update_two.amount_a, swap_update_two.amount_b)
    } else {
        (swap_update_two.amount_b, swap_update_two.amount_a)
    };
    let input_transfer_fee_two = pino_calculate_transfer_fee_excluded_amount(
        token_mint_intermediate_info,
        input_amount_two,
    )?
    .transfer_fee;
    let output_transfer_fee_two =
        pino_calculate_transfer_fee_excluded_amount(token_mint_output_info, output_amount_two)?
            .transfer_fee;
    let (lp_fee_two, protocol_fee_two) =
        (swap_update_two.lp_fee, swap_update_two.next_protocol_fee);

    pino_update_and_two_hop_swap_whirlpool_v2(
        &swap_update_one,
        &swap_update_two,
        &mut whirlpool_one,
        whirlpool_one_info,
        &mut whirlpool_two,
        whirlpool_two_info,
        data.a_to_b_one,
        data.a_to_b_two,
        token_mint_input_info,
        token_mint_intermediate_info,
        token_mint_output_info,
        token_program_input_info,
        token_program_intermediate_info,
        token_program_output_info,
        token_owner_account_input_info,
        token_vault_one_input_info,
        token_vault_one_intermediate_info,
        token_vault_two_intermediate_info,
        token_vault_two_output_info,
        token_owner_account_output_info,
        &remaining_accounts.transfer_hook_input,
        &remaining_accounts.transfer_hook_intermediate,
        &remaining_accounts.transfer_hook_output,
        token_authority_info,
        memo_program_info,
        timestamp,
        transfer_memo::TRANSFER_MEMO_SWAP.as_bytes(),
    )?;

    Event::Traded {
        whirlpool: whirlpool_one_info.key(),
        a_to_b: data.a_to_b_one,
        pre_sqrt_price: pre_sqrt_price_one,
        post_sqrt_price: whirlpool_one.sqrt_price(),
        input_amount: input_amount_one,
        output_amount: output_amount_one,
        input_transfer_fee: input_transfer_fee_one,
        output_transfer_fee: output_transfer_fee_one,
        lp_fee: lp_fee_one,
        protocol_fee: protocol_fee_one,
    }.emit()?;

    Event::Traded {
        whirlpool: whirlpool_two_info.key(),
        a_to_b: data.a_to_b_two,
        pre_sqrt_price: pre_sqrt_price_two,
        post_sqrt_price: whirlpool_two.sqrt_price(),
        input_amount: input_amount_two,
        output_amount: output_amount_two,
        input_transfer_fee: input_transfer_fee_two,
        output_transfer_fee: output_transfer_fee_two,
        lp_fee: lp_fee_two,
        protocol_fee: protocol_fee_two,
    }.emit()?;

    Ok(())
}


// ----------------------------------------

// swap utils

#[allow(clippy::too_many_arguments)]
pub fn pino_update_and_two_hop_swap_whirlpool_v2(
    // update
    swap_update_one: &PostSwapUpdate,
    swap_update_two: &PostSwapUpdate,
    // whirlpool
    whirlpool_one: &mut MemoryMappedWhirlpool,
    whirlpool_one_info: &AccountInfo,
    whirlpool_two: &mut MemoryMappedWhirlpool,
    whirlpool_two_info: &AccountInfo,
    // direction
    is_token_fee_in_one_a: bool,
    is_token_fee_in_two_a: bool,
    // mint
    token_mint_input_info: &AccountInfo,
    token_mint_intermediate_info: &AccountInfo,
    token_mint_output_info: &AccountInfo,
    // token program
    token_program_input_info: &AccountInfo,
    token_program_intermediate_info: &AccountInfo,
    token_program_output_info: &AccountInfo,
    // token accounts
    token_owner_account_input_info: &AccountInfo,
    token_vault_one_input_info: &AccountInfo,
    token_vault_one_intermediate_info: &AccountInfo,
    token_vault_two_intermediate_info: &AccountInfo,
    token_vault_two_output_info: &AccountInfo,
    token_owner_account_output_info: &AccountInfo,
    // hook
    transfer_hook_input_infos: &Option<Vec<&AccountInfo>>,
    transfer_hook_intermediate_infos: &Option<Vec<&AccountInfo>>,
    transfer_hook_output_infos: &Option<Vec<&AccountInfo>>,
    // common
    token_authority_info: &AccountInfo,
    memo_program_info: &AccountInfo,
    reward_last_updated_timestamp: u64,
    memo: &[u8],
) -> Result<()> {
    whirlpool_one.update_after_swap(
        &swap_update_one.next_liquidity,
        swap_update_one.next_tick_index,
        &swap_update_one.next_sqrt_price,
        &swap_update_one.next_fee_growth_global,
        &swap_update_one.next_reward_growths_global,
        swap_update_one.next_protocol_fee,
        is_token_fee_in_one_a,
        reward_last_updated_timestamp,
    );

    whirlpool_two.update_after_swap(
        &swap_update_two.next_liquidity,
        swap_update_two.next_tick_index,
        &swap_update_two.next_sqrt_price,
        &swap_update_two.next_fee_growth_global,
        &swap_update_two.next_reward_growths_global,
        swap_update_two.next_protocol_fee,
        is_token_fee_in_two_a,
        reward_last_updated_timestamp,
    );

    // amount
    let (input_amount, intermediate_amount) = if is_token_fee_in_one_a {
        (swap_update_one.amount_a, swap_update_one.amount_b)
    } else {
        (swap_update_one.amount_b, swap_update_one.amount_a)
    };
    let output_amount = if is_token_fee_in_two_a {
        swap_update_two.amount_b
    } else {
        swap_update_two.amount_a
    };

    pino_transfer_from_owner_to_vault_v2(
        token_authority_info,
        token_mint_input_info,
        token_owner_account_input_info,
        token_vault_one_input_info,
        token_program_input_info,
        memo_program_info,
        transfer_hook_input_infos,
        input_amount,
    )?;

    // Transfer from pool to pool
    pino_transfer_from_vault_to_owner_v2(
        whirlpool_one,
        whirlpool_one_info,
        token_mint_intermediate_info,
        token_vault_one_intermediate_info,
        token_vault_two_intermediate_info,
        token_program_intermediate_info,
        memo_program_info,
        transfer_hook_intermediate_infos,
        intermediate_amount,
        memo,
    )?;

    pino_transfer_from_vault_to_owner_v2(
        whirlpool_two,
        whirlpool_two_info,
        token_mint_output_info,
        token_vault_two_output_info,
        token_owner_account_output_info,
        token_program_output_info,
        memo_program_info,
        transfer_hook_output_infos,
        output_amount,
        memo,
    )?;

    Ok(())
}
