use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

use crate::swap_with_transfer_fee_extension;
use crate::util::{calculate_transfer_fee_excluded_amount, parse_remaining_accounts, update_and_two_hop_swap_whirlpool_v2, AccountsType, RemainingAccountsInfo};
use crate::{
    errors::ErrorCode,
    state::Whirlpool,
    util::{to_timestamp_u64, SparseSwapTickSequenceBuilder},
    constants::transfer_memo,
};

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

    #[account(constraint = token_mint_input.key() == whirlpool_one.input_token_mint(a_to_b_one))]
    pub token_mint_input: InterfaceAccount<'info, Mint>,
    #[account(constraint = token_mint_intermediate.key() == whirlpool_one.output_token_mint(a_to_b_one))]
    pub token_mint_intermediate: InterfaceAccount<'info, Mint>,
    #[account(constraint = token_mint_output.key() == whirlpool_two.output_token_mint(a_to_b_two))]
    pub token_mint_output: InterfaceAccount<'info, Mint>,

    #[account(constraint = token_program_input.key() == token_mint_input.to_account_info().owner.clone())]
    pub token_program_input: Interface<'info, TokenInterface>,
    #[account(constraint = token_program_intermediate.key() == token_mint_intermediate.to_account_info().owner.clone())]
    pub token_program_intermediate: Interface<'info, TokenInterface>,
    #[account(constraint = token_program_output.key() == token_mint_output.to_account_info().owner.clone())]
    pub token_program_output: Interface<'info, TokenInterface>,

    #[account(mut, constraint = token_owner_account_input.mint == token_mint_input.key())]
    pub token_owner_account_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_vault_one_input.key() == whirlpool_one.input_token_vault(a_to_b_one))]
    pub token_vault_one_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_vault_one_intermediate.key() == whirlpool_one.output_token_vault(a_to_b_one))]
    pub token_vault_one_intermediate: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_vault_two_intermediate.key() == whirlpool_two.input_token_vault(a_to_b_two))]
    pub token_vault_two_intermediate: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = token_vault_two_output.key() == whirlpool_two.output_token_vault(a_to_b_two))]
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

pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, TwoHopSwapV2<'info>>,
    amount: u64,
    other_amount_threshold: u64,
    amount_specified_is_input: bool,
    a_to_b_one: bool,
    a_to_b_two: bool,
    sqrt_price_limit_one: u128,
    sqrt_price_limit_two: u128,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
) -> Result<()> {
    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let whirlpool_one = &mut ctx.accounts.whirlpool_one;
    let whirlpool_two = &mut ctx.accounts.whirlpool_two;

    // Don't allow swaps on the same whirlpool
    if whirlpool_one.key() == whirlpool_two.key() {
        return Err(ErrorCode::DuplicateTwoHopPool.into());
    }

    let swap_one_output_mint = if a_to_b_one {
        whirlpool_one.token_mint_b
    } else {
        whirlpool_one.token_mint_a
    };

    let swap_two_input_mint = if a_to_b_two {
        whirlpool_two.token_mint_a
    } else {
        whirlpool_two.token_mint_b
    };
    if swap_one_output_mint != swap_two_input_mint {
        return Err(ErrorCode::InvalidIntermediaryMint.into());
    }

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        &ctx.remaining_accounts,
        &remaining_accounts_info,
        &[
            AccountsType::TransferHookInput,
            AccountsType::TransferHookIntermediate,
            AccountsType::TransferHookOutput,
            AccountsType::SupplementalTickArraysOne,
            AccountsType::SupplementalTickArraysTwo,
        ],
    )?;

    let builder_one = SparseSwapTickSequenceBuilder::try_from(
        whirlpool_one,
        a_to_b_one,
        vec![
            ctx.accounts.tick_array_one_0.to_account_info(),
            ctx.accounts.tick_array_one_1.to_account_info(),
            ctx.accounts.tick_array_one_2.to_account_info(),
        ],
        remaining_accounts.supplemental_tick_arrays_one,
    )?;
    let mut swap_tick_sequence_one = builder_one.build()?;

    let builder_two = SparseSwapTickSequenceBuilder::try_from(
        whirlpool_two,
        a_to_b_two,
        vec![
            ctx.accounts.tick_array_two_0.to_account_info(),
            ctx.accounts.tick_array_two_1.to_account_info(),
            ctx.accounts.tick_array_two_2.to_account_info(),
        ],
        remaining_accounts.supplemental_tick_arrays_two,
    )?;
    let mut swap_tick_sequence_two = builder_two.build()?;

    // TODO: WLOG, we could extend this to N-swaps, but the account inputs to the instruction would
    // need to be jankier and we may need to programatically map/verify rather than using anchor constraints
    let (swap_update_one, swap_update_two) = if amount_specified_is_input {
        // If the amount specified is input, this means we are doing exact-in
        // and the swap calculations occur from Swap 1 => Swap 2
        // and the swaps occur from Swap 1 => Swap 2
        let swap_calc_one = swap_with_transfer_fee_extension(
            &whirlpool_one,
            if a_to_b_one { &ctx.accounts.token_mint_input } else { &ctx.accounts.token_mint_intermediate },
            if a_to_b_one { &ctx.accounts.token_mint_intermediate } else { &ctx.accounts.token_mint_input },
            &mut swap_tick_sequence_one,
            amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // true
            a_to_b_one,
            timestamp,
        )?;

        // Swap two input is the output of swap one
        // We use vault to vault transfer, so transfer fee will be collected once.
        let swap_two_input_amount = if a_to_b_one {
            swap_calc_one.amount_b
        } else {
            swap_calc_one.amount_a
        };

        let swap_calc_two = swap_with_transfer_fee_extension(
            &whirlpool_two,
            if a_to_b_two { &ctx.accounts.token_mint_intermediate } else { &ctx.accounts.token_mint_output },
            if a_to_b_two { &ctx.accounts.token_mint_output } else { &ctx.accounts.token_mint_intermediate },
            &mut swap_tick_sequence_two,
            swap_two_input_amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // true
            a_to_b_two,
            timestamp,
        )?;
        (swap_calc_one, swap_calc_two)
    } else {
        // If the amount specified is output, this means we need to invert the ordering of the calculations
        // and the swap calculations occur from Swap 2 => Swap 1
        // but the actual swaps occur from Swap 1 => Swap 2 (to ensure that the intermediate token exists in the account)
        let swap_calc_two = swap_with_transfer_fee_extension(
            &whirlpool_two,
            if a_to_b_two { &ctx.accounts.token_mint_intermediate } else { &ctx.accounts.token_mint_output },
            if a_to_b_two { &ctx.accounts.token_mint_output } else { &ctx.accounts.token_mint_intermediate },
            &mut swap_tick_sequence_two,
            amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // false
            a_to_b_two,
            timestamp,
        )?;

        // The output of swap 1 is input of swap_calc_two
        let swap_one_output_amount = if a_to_b_two {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_intermediate,
                swap_calc_two.amount_a
            )?.amount
        } else {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_intermediate,
                swap_calc_two.amount_b
            )?.amount
        };

        let swap_calc_one = swap_with_transfer_fee_extension(
            &whirlpool_one,
            if a_to_b_one { &ctx.accounts.token_mint_input } else { &ctx.accounts.token_mint_intermediate },
            if a_to_b_one { &ctx.accounts.token_mint_intermediate } else { &ctx.accounts.token_mint_input },
            &mut swap_tick_sequence_one,
            swap_one_output_amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // false
            a_to_b_one,
            timestamp,
        )?;
        (swap_calc_one, swap_calc_two)
    };

    // All output token should be consumed by the second swap
    let swap_calc_one_output = if a_to_b_one { swap_update_one.amount_b } else { swap_update_one.amount_a };
    let swap_calc_two_input = if a_to_b_two { swap_update_two.amount_a } else { swap_update_two.amount_b };
    if swap_calc_one_output != swap_calc_two_input {
        return Err(ErrorCode::IntermediateTokenAmountMismatch.into());
    }

    if amount_specified_is_input {
        // If amount_specified_is_input == true, then we have a variable amount of output
        // The slippage we care about is the output of the second swap.
        let output_amount = if a_to_b_two {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_output,
                swap_update_two.amount_b
            )?.amount
        } else {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_output,
                swap_update_two.amount_a
            )?.amount
        };

        // If we have received less than the minimum out, throw an error
        if output_amount < other_amount_threshold {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        // amount_specified_is_output == false, then we have a variable amount of input
        // The slippage we care about is the input of the first swap
        let input_amount = if a_to_b_one {
            swap_update_one.amount_a
        } else {
            swap_update_one.amount_b
        };
        if input_amount > other_amount_threshold {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    /*
    update_and_swap_whirlpool_v2(
        whirlpool_one,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_mint_one_a,
        &ctx.accounts.token_mint_one_b,
        &ctx.accounts.token_owner_account_one_a,
        &ctx.accounts.token_owner_account_one_b,
        &ctx.accounts.token_vault_one_a,
        &ctx.accounts.token_vault_one_b,
        &remaining_accounts.transfer_hook_one_a,
        &remaining_accounts.transfer_hook_one_b,
        &ctx.accounts.token_program_one_a,
        &ctx.accounts.token_program_one_b,
        &ctx.accounts.memo_program,
        swap_update_one,
        a_to_b_one,
        timestamp,
        transfer_memo::TRANSFER_MEMO_SWAP.as_bytes(),
    )?;

    update_and_swap_whirlpool_v2(
        whirlpool_two,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_mint_two_a,
        &ctx.accounts.token_mint_two_b,
        &ctx.accounts.token_owner_account_two_a,
        &ctx.accounts.token_owner_account_two_b,
        &ctx.accounts.token_vault_two_a,
        &ctx.accounts.token_vault_two_b,
        &remaining_accounts.transfer_hook_two_a,
        &remaining_accounts.transfer_hook_two_b,
        &ctx.accounts.token_program_two_a,
        &ctx.accounts.token_program_two_b,
        &ctx.accounts.memo_program,
        swap_update_two,
        a_to_b_two,
        timestamp,
        transfer_memo::TRANSFER_MEMO_SWAP.as_bytes(),
    )
    */

    update_and_two_hop_swap_whirlpool_v2(
        swap_update_one,
        swap_update_two,
        whirlpool_one,
        whirlpool_two,
        a_to_b_one,
        a_to_b_two,
        &ctx.accounts.token_mint_input,
        &ctx.accounts.token_mint_intermediate,
        &ctx.accounts.token_mint_output,
        &ctx.accounts.token_program_input,
        &ctx.accounts.token_program_intermediate,
        &ctx.accounts.token_program_output,
        &ctx.accounts.token_owner_account_input,
        &ctx.accounts.token_vault_one_input,
        &ctx.accounts.token_vault_one_intermediate,
        &ctx.accounts.token_vault_two_intermediate,
        &ctx.accounts.token_vault_two_output,
        &ctx.accounts.token_owner_account_output,
        &remaining_accounts.transfer_hook_input,
        &remaining_accounts.transfer_hook_intermediate,
        &remaining_accounts.transfer_hook_output,
        &ctx.accounts.token_authority,
        &ctx.accounts.memo_program,
        timestamp,
        transfer_memo::TRANSFER_MEMO_SWAP.as_bytes(),
    )
}
