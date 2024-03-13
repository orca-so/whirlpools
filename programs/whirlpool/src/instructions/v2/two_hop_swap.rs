use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

use crate::swap_with_transfer_fee_extension;
use crate::util::{calculate_transfer_fee_excluded_amount, parse_remaining_accounts, AccountsType, RemainingAccountsInfo};
use crate::{
    errors::ErrorCode,
    state::{TickArray, Whirlpool},
    util::{to_timestamp_u64, v2::update_and_swap_whirlpool_v2, SwapTickSequence},
    constants::transfer_memo,
};

#[derive(Accounts)]
pub struct TwoHopSwapV2<'info> {
    #[account(address = token_mint_one_a.to_account_info().owner.clone())]
    pub token_program_one_a: Interface<'info, TokenInterface>,
    #[account(address = token_mint_one_b.to_account_info().owner.clone())]
    pub token_program_one_b: Interface<'info, TokenInterface>,
    #[account(address = token_mint_two_a.to_account_info().owner.clone())]
    pub token_program_two_a: Interface<'info, TokenInterface>,
    #[account(address = token_mint_two_b.to_account_info().owner.clone())]
    pub token_program_two_b: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,

    pub token_authority: Signer<'info>,

    #[account(mut)]
    pub whirlpool_one: Box<Account<'info, Whirlpool>>,

    #[account(mut)]
    pub whirlpool_two: Box<Account<'info, Whirlpool>>,

    #[account(address = whirlpool_one.token_mint_a)]
    pub token_mint_one_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool_one.token_mint_b)]
    pub token_mint_one_b: InterfaceAccount<'info, Mint>,

    #[account(mut, constraint = token_owner_account_one_a.mint == whirlpool_one.token_mint_a)]
    pub token_owner_account_one_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_one.token_vault_a)]
    pub token_vault_one_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_one_b.mint == whirlpool_one.token_mint_b)]
    pub token_owner_account_one_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_one.token_vault_b)]
    pub token_vault_one_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = whirlpool_two.token_mint_a)]
    pub token_mint_two_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool_two.token_mint_b)]
    pub token_mint_two_b: InterfaceAccount<'info, Mint>,

    #[account(mut, constraint = token_owner_account_two_a.mint == whirlpool_two.token_mint_a)]
    pub token_owner_account_two_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_two.token_vault_a)]
    pub token_vault_two_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_two_b.mint == whirlpool_two.token_mint_b)]
    pub token_owner_account_two_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool_two.token_vault_b)]
    pub token_vault_two_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = tick_array_one_0.load()?.whirlpool == whirlpool_one.key())]
    pub tick_array_one_0: AccountLoader<'info, TickArray>,

    #[account(mut, constraint = tick_array_one_1.load()?.whirlpool == whirlpool_one.key())]
    pub tick_array_one_1: AccountLoader<'info, TickArray>,

    #[account(mut, constraint = tick_array_one_2.load()?.whirlpool == whirlpool_one.key())]
    pub tick_array_one_2: AccountLoader<'info, TickArray>,

    #[account(mut, constraint = tick_array_two_0.load()?.whirlpool == whirlpool_two.key())]
    pub tick_array_two_0: AccountLoader<'info, TickArray>,

    #[account(mut, constraint = tick_array_two_1.load()?.whirlpool == whirlpool_two.key())]
    pub tick_array_two_1: AccountLoader<'info, TickArray>,

    #[account(mut, constraint = tick_array_two_2.load()?.whirlpool == whirlpool_two.key())]
    pub tick_array_two_2: AccountLoader<'info, TickArray>,

    #[account(mut, seeds = [b"oracle", whirlpool_one.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_one: UncheckedAccount<'info>,

    #[account(mut, seeds = [b"oracle", whirlpool_two.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle_two: UncheckedAccount<'info>,
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
    remaining_accounts_info: RemainingAccountsInfo,
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
            AccountsType::TransferHookOneA,
            AccountsType::TransferHookOneB,
            AccountsType::TransferHookTwoA,
            AccountsType::TransferHookTwoB,
        ],
    )?;


    let mut swap_tick_sequence_one = SwapTickSequence::new(
        ctx.accounts.tick_array_one_0.load_mut().unwrap(),
        ctx.accounts.tick_array_one_1.load_mut().ok(),
        ctx.accounts.tick_array_one_2.load_mut().ok(),
    );

    let mut swap_tick_sequence_two = SwapTickSequence::new(
        ctx.accounts.tick_array_two_0.load_mut().unwrap(),
        ctx.accounts.tick_array_two_1.load_mut().ok(),
        ctx.accounts.tick_array_two_2.load_mut().ok(),
    );

    // TODO: WLOG, we could extend this to N-swaps, but the account inputs to the instruction would
    // need to be jankier and we may need to programatically map/verify rather than using anchor constraints
    let (swap_update_one, swap_update_two) = if amount_specified_is_input {
        // If the amount specified is input, this means we are doing exact-in
        // and the swap calculations occur from Swap 1 => Swap 2
        // and the swaps occur from Swap 1 => Swap 2
        let swap_calc_one = swap_with_transfer_fee_extension(
            &whirlpool_one,
            &ctx.accounts.token_mint_one_a,
            &ctx.accounts.token_mint_one_b,
            &mut swap_tick_sequence_one,
            amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // true
            a_to_b_one,
            timestamp,
        )?;

        // Swap two input is the output of swap one
        let swap_two_input_amount = if a_to_b_one {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_one_b,
                swap_calc_one.amount_b
            )?.amount
        } else {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_one_a,
                swap_calc_one.amount_a
            )?.amount
        };

        let swap_calc_two = swap_with_transfer_fee_extension(
            &whirlpool_two,
            &ctx.accounts.token_mint_two_a,
            &ctx.accounts.token_mint_two_b,
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
            &ctx.accounts.token_mint_two_a,
            &ctx.accounts.token_mint_two_b,
            &mut swap_tick_sequence_two,
            amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // false
            a_to_b_two,
            timestamp,
        )?;

        // The output of swap 1 is input of swap_calc_two
        let swap_one_output_amount = if a_to_b_two {
            swap_calc_two.amount_a
        } else {
            swap_calc_two.amount_b
        };

        let swap_calc_one = swap_with_transfer_fee_extension(
            &whirlpool_one,
            &ctx.accounts.token_mint_one_a,
            &ctx.accounts.token_mint_one_b,
            &mut swap_tick_sequence_one,
            swap_one_output_amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // false
            a_to_b_one,
            timestamp,
        )?;
        (swap_calc_one, swap_calc_two)
    };

    if amount_specified_is_input {
        // If amount_specified_is_input == true, then we have a variable amount of output
        // The slippage we care about is the output of the second swap.
        let output_amount = if a_to_b_two {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_two_b,
                swap_update_two.amount_b
            )?.amount
        } else {
            calculate_transfer_fee_excluded_amount(
                &ctx.accounts.token_mint_two_a,
                swap_update_two.amount_a
            )?.amount
        };

        // If we have received less than the minimum out, throw an error
        if other_amount_threshold > output_amount {
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
        if other_amount_threshold < input_amount {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

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
}
