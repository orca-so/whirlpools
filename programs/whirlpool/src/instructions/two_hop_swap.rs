use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    events::*,
    manager::swap_manager::*,
    state::{OracleAccessor, Whirlpool},
    util::{to_timestamp_u64, update_and_swap_whirlpool, SparseSwapTickSequenceBuilder},
};

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

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<TwoHopSwap>,
    amount: u64,
    other_amount_threshold: u64,
    amount_specified_is_input: bool,
    a_to_b_one: bool,
    a_to_b_two: bool,
    sqrt_price_limit_one: u128,
    sqrt_price_limit_two: u128,
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

    let swap_tick_sequence_builder_one = SparseSwapTickSequenceBuilder::new(
        vec![
            ctx.accounts.tick_array_one_0.to_account_info(),
            ctx.accounts.tick_array_one_1.to_account_info(),
            ctx.accounts.tick_array_one_2.to_account_info(),
        ],
        None,
    );
    let mut swap_tick_sequence_one =
        swap_tick_sequence_builder_one.try_build(whirlpool_one, a_to_b_one)?;

    let swap_tick_sequence_builder_two = SparseSwapTickSequenceBuilder::new(
        vec![
            ctx.accounts.tick_array_two_0.to_account_info(),
            ctx.accounts.tick_array_two_1.to_account_info(),
            ctx.accounts.tick_array_two_2.to_account_info(),
        ],
        None,
    );
    let mut swap_tick_sequence_two =
        swap_tick_sequence_builder_two.try_build(whirlpool_two, a_to_b_two)?;

    let oracle_accessor_one =
        OracleAccessor::new(whirlpool_one, ctx.accounts.oracle_one.to_account_info())?;
    if !oracle_accessor_one.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info_one = oracle_accessor_one.get_adaptive_fee_info()?;

    let oracle_accessor_two =
        OracleAccessor::new(whirlpool_two, ctx.accounts.oracle_two.to_account_info())?;
    if !oracle_accessor_two.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info_two = oracle_accessor_two.get_adaptive_fee_info()?;

    // TODO: WLOG, we could extend this to N-swaps, but the account inputs to the instruction would
    // need to be jankier and we may need to programatically map/verify rather than using anchor constraints
    let (swap_update_one, swap_update_two) = if amount_specified_is_input {
        // If the amount specified is input, this means we are doing exact-in
        // and the swap calculations occur from Swap 1 => Swap 2
        // and the swaps occur from Swap 1 => Swap 2
        let swap_calc_one = swap(
            whirlpool_one,
            &mut swap_tick_sequence_one,
            amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // true
            a_to_b_one,
            timestamp,
            &adaptive_fee_info_one,
        )?;

        // Swap two input is the output of swap one
        let swap_two_input_amount = if a_to_b_one {
            swap_calc_one.amount_b
        } else {
            swap_calc_one.amount_a
        };

        let swap_calc_two = swap(
            whirlpool_two,
            &mut swap_tick_sequence_two,
            swap_two_input_amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // true
            a_to_b_two,
            timestamp,
            &adaptive_fee_info_two,
        )?;
        (swap_calc_one, swap_calc_two)
    } else {
        // If the amount specified is output, this means we need to invert the ordering of the calculations
        // and the swap calculations occur from Swap 2 => Swap 1
        // but the actual swaps occur from Swap 1 => Swap 2 (to ensure that the intermediate token exists in the account)
        let swap_calc_two = swap(
            whirlpool_two,
            &mut swap_tick_sequence_two,
            amount,
            sqrt_price_limit_two,
            amount_specified_is_input, // false
            a_to_b_two,
            timestamp,
            &adaptive_fee_info_two,
        )?;

        // The output of swap 1 is input of swap_calc_two
        let swap_one_output_amount = if a_to_b_two {
            swap_calc_two.amount_a
        } else {
            swap_calc_two.amount_b
        };

        let swap_calc_one = swap(
            whirlpool_one,
            &mut swap_tick_sequence_one,
            swap_one_output_amount,
            sqrt_price_limit_one,
            amount_specified_is_input, // false
            a_to_b_one,
            timestamp,
            &adaptive_fee_info_one,
        )?;
        (swap_calc_one, swap_calc_two)
    };

    // All output token should be consumed by the second swap
    let swap_calc_one_output = if a_to_b_one {
        swap_update_one.amount_b
    } else {
        swap_update_one.amount_a
    };
    let swap_calc_two_input = if a_to_b_two {
        swap_update_two.amount_a
    } else {
        swap_update_two.amount_b
    };
    if swap_calc_one_output != swap_calc_two_input {
        return Err(ErrorCode::IntermediateTokenAmountMismatch.into());
    }

    if amount_specified_is_input {
        // If amount_specified_is_input == true, then we have a variable amount of output
        // The slippage we care about is the output of the second swap.
        let output_amount = if a_to_b_two {
            swap_update_two.amount_b
        } else {
            swap_update_two.amount_a
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

    oracle_accessor_one.update_adaptive_fee_variables(&swap_update_one.next_adaptive_fee_info)?;

    oracle_accessor_two.update_adaptive_fee_variables(&swap_update_two.next_adaptive_fee_info)?;

    let pre_sqrt_price_one = whirlpool_one.sqrt_price;
    let (input_amount_one, output_amount_one) = if a_to_b_one {
        (swap_update_one.amount_a, swap_update_one.amount_b)
    } else {
        (swap_update_one.amount_b, swap_update_one.amount_a)
    };
    let (lp_fee_one, protocol_fee_one) =
        (swap_update_one.lp_fee, swap_update_one.next_protocol_fee);

    update_and_swap_whirlpool(
        whirlpool_one,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_owner_account_one_a,
        &ctx.accounts.token_owner_account_one_b,
        &ctx.accounts.token_vault_one_a,
        &ctx.accounts.token_vault_one_b,
        &ctx.accounts.token_program,
        &swap_update_one,
        a_to_b_one,
        timestamp,
    )?;

    let pre_sqrt_price_two = whirlpool_two.sqrt_price;
    let (input_amount_two, output_amount_two) = if a_to_b_two {
        (swap_update_two.amount_a, swap_update_two.amount_b)
    } else {
        (swap_update_two.amount_b, swap_update_two.amount_a)
    };
    let (lp_fee_two, protocol_fee_two) =
        (swap_update_two.lp_fee, swap_update_two.next_protocol_fee);

    update_and_swap_whirlpool(
        whirlpool_two,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_owner_account_two_a,
        &ctx.accounts.token_owner_account_two_b,
        &ctx.accounts.token_vault_two_a,
        &ctx.accounts.token_vault_two_b,
        &ctx.accounts.token_program,
        &swap_update_two,
        a_to_b_two,
        timestamp,
    )?;

    emit!(Traded {
        whirlpool: whirlpool_one.key(),
        a_to_b: a_to_b_one,
        pre_sqrt_price: pre_sqrt_price_one,
        post_sqrt_price: whirlpool_one.sqrt_price,
        input_amount: input_amount_one,
        output_amount: output_amount_one,
        input_transfer_fee: 0,
        output_transfer_fee: 0,
        lp_fee: lp_fee_one,
        protocol_fee: protocol_fee_one,
    });

    emit!(Traded {
        whirlpool: whirlpool_two.key(),
        a_to_b: a_to_b_two,
        pre_sqrt_price: pre_sqrt_price_two,
        post_sqrt_price: whirlpool_two.sqrt_price,
        input_amount: input_amount_two,
        output_amount: output_amount_two,
        input_transfer_fee: 0,
        output_transfer_fee: 0,
        lp_fee: lp_fee_two,
        protocol_fee: protocol_fee_two,
    });

    Ok(())
}
