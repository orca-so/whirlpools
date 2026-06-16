use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use anchor_lang::solana_program::program::set_return_data;
use borsh::BorshSerialize;
use crate::instructions::swap_with_transfer_fee_extension;
use crate::util::calculate_transfer_fee_excluded_amount;
use crate::{
    errors::ErrorCode,
    state::*,
    util::{
        parse_remaining_accounts, to_timestamp_u64, AccountsType,
        RemainingAccountsInfo, SparseSwapTickSequenceBuilder,
    },
};

#[derive(Accounts)]
pub struct PrepareSwapV2<'info> {
    #[account(mut)]
    pub prepared_swap: AccountLoader<'info, PreparedSwap>,

    pub token_authority: Signer<'info>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(address = whirlpool.token_mint_a)]
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool.token_mint_b)]
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    /// CHECK: checked in the handler
    pub tick_array_0: UncheckedAccount<'info>,

    /// CHECK: checked in the handler
    pub tick_array_1: UncheckedAccount<'info>,

    /// CHECK: checked in the handler
    pub tick_array_2: UncheckedAccount<'info>,

    #[account(seeds = [b"oracle", whirlpool.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle: UncheckedAccount<'info>,
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
    // - supplemental TickArray accounts
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum PrepareSwapV2ReturnData {
    QuoteSuccess {
        amount: u64,
        other_amount: u64,
        next_sqrt_price: u128,
        next_tick_index: i32,
    },
    QuoteError {
        error_code: u64,
    },
}

pub fn handler<'info>(
    // TODO: consider CU limit param
    ctx: Context<'_, '_, '_, 'info, PrepareSwapV2<'info>>,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
) -> Result<()> {
    // Errors that occur during quote computation are wrapped in PrepareSwapV2ReturnData::QuoteError
    // and returned as part of the result, rather than causing the transaction to fail.
    //
    // On the other hand, the following conditions indicate that something is fundamentally wrong,
    // so the transaction should fail:
    // - Failed to load the PreparedSwap account
    // - Failed to serialize PrepareSwapV2ReturnData

    let mut prepared_swap = ctx.accounts.prepared_swap.load_mut()?;
    prepared_swap.reset();

    let return_data = match try_prepare_swap(
        &ctx,
        amount,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        remaining_accounts_info,
        &mut prepared_swap,
    ) {
        Ok(return_data) => return_data,
        Err(err) => {
            let program_err: anchor_lang::solana_program::program_error::ProgramError = err.into();
            let error_code: u64 = program_err.into();
            PrepareSwapV2ReturnData::QuoteError { error_code }
        }
    };

    set_return_data(&return_data.try_to_vec()?);
    Ok(())
}

fn try_prepare_swap<'info>(
    ctx: &Context<'_, '_, '_, 'info, PrepareSwapV2<'info>>,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
    prepared_swap: &mut PreparedSwap,
) -> Result<PrepareSwapV2ReturnData> {
    let clock = Clock::get()?;

    prepared_swap.set_precondition(
        ctx.accounts.token_authority.key(),
        ctx.accounts.whirlpool.key(),
        ctx.accounts.whirlpool.state_sequence(),
        amount,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        clock.slot,
    );

    let whirlpool = &ctx.accounts.whirlpool;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        ctx.remaining_accounts,
        &remaining_accounts_info,
        &[
            AccountsType::TransferHookA,
            AccountsType::TransferHookB,
            AccountsType::SupplementalTickArrays,
        ],
    )?;

    let swap_tick_sequence_builder = SparseSwapTickSequenceBuilder::new(
        vec![
            ctx.accounts.tick_array_0.to_account_info(),
            ctx.accounts.tick_array_1.to_account_info(),
            ctx.accounts.tick_array_2.to_account_info(),
        ],
        remaining_accounts.supplemental_tick_arrays,
    );
    let mut swap_tick_sequence = swap_tick_sequence_builder.try_build_with_prepared_swap(
        whirlpool,
        a_to_b,
        prepared_swap
    )?;

    let oracle_accessor = OracleAccessor::new(whirlpool, ctx.accounts.oracle.to_account_info())?;
    if !oracle_accessor.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info = oracle_accessor.get_adaptive_fee_info()?;

    let swap_update = swap_with_transfer_fee_extension(
        whirlpool,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.token_mint_b,
        &mut swap_tick_sequence,
        amount,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        timestamp,
        &adaptive_fee_info,
    )?;

    let transfer_fee_included_input_amount = if a_to_b {
        swap_update.amount_a
    } else {
        swap_update.amount_b
    };
    let transfer_fee_excluded_output_amount = if a_to_b {
        calculate_transfer_fee_excluded_amount(
            &ctx.accounts.token_mint_b,
            swap_update.amount_b,
        )?
        .amount
    } else {
        calculate_transfer_fee_excluded_amount(
            &ctx.accounts.token_mint_a,
            swap_update.amount_a,
        )?
        .amount
    };
    let (amount, other_amount) = if amount_specified_is_input {
        (transfer_fee_included_input_amount, transfer_fee_excluded_output_amount)
    } else {
        (transfer_fee_excluded_output_amount, transfer_fee_included_input_amount)
    };

    let return_data = PrepareSwapV2ReturnData::QuoteSuccess {
        amount,
        other_amount,
        next_sqrt_price: swap_update.next_sqrt_price,
        next_tick_index: swap_update.next_tick_index,
    };

    prepared_swap.set_pending_post_swap_update(&swap_update);
    prepared_swap.set_state(PreparedSwapState::Prepared);

    Ok(return_data)
}
