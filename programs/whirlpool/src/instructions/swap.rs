use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    manager::swap_manager::*,
    state::{TickArray, Whirlpool},
    util::{
        to_timestamp_u64, transfer_from_owner_to_vault, transfer_from_vault_to_owner,
        SwapTickSequence,
    },
};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    pub token_authority: Signer<'info>,

    #[account(mut)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_a)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_b)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_0: AccountLoader<'info, TickArray>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_1: AccountLoader<'info, TickArray>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_2: AccountLoader<'info, TickArray>,

    #[account(seeds = [b"oracle", whirlpool.key().as_ref()],bump)]
    /// Oracle is currently unused and will be enabled on subsequent updates
    pub oracle: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<Swap>,
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool, // Zero for one
) -> ProgramResult {
    let whirlpool = &mut ctx.accounts.whirlpool;
    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;
    let mut swap_tick_sequence = SwapTickSequence::new(
        ctx.accounts.tick_array_0.load_mut().unwrap(),
        ctx.accounts.tick_array_1.load_mut().ok(),
        ctx.accounts.tick_array_2.load_mut().ok(),
    );

    let swap_update = swap(
        &whirlpool,
        &mut swap_tick_sequence,
        amount,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        timestamp,
    )?;

    if amount_specified_is_input {
        if (a_to_b && other_amount_threshold > swap_update.amount_b)
            || (!a_to_b && other_amount_threshold > swap_update.amount_a)
        {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        if (a_to_b && other_amount_threshold < swap_update.amount_a)
            || (!a_to_b && other_amount_threshold < swap_update.amount_b)
        {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    whirlpool.update_after_swap(
        swap_update.next_liquidity,
        swap_update.next_tick_index,
        swap_update.next_sqrt_price,
        swap_update.next_fee_growth_global,
        swap_update.next_reward_infos,
        swap_update.next_protocol_fee,
        a_to_b,
        timestamp,
    );

    perform_swap(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_program,
        swap_update.amount_a,
        swap_update.amount_b,
        a_to_b,
    )
}

fn perform_swap<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    token_authority: &Signer<'info>,
    token_owner_account_a: &Account<'info, TokenAccount>,
    token_owner_account_b: &Account<'info, TokenAccount>,
    token_vault_a: &Account<'info, TokenAccount>,
    token_vault_b: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount_a: u64,
    amount_b: u64,
    a_to_b: bool,
) -> ProgramResult {
    // Transfer from user to pool
    let deposit_account_user;
    let deposit_account_pool;
    let deposit_amount;

    // Transfer from pool to user
    let withdrawal_account_user;
    let withdrawal_account_pool;
    let withdrawal_amount;

    if a_to_b {
        deposit_account_user = token_owner_account_a;
        deposit_account_pool = token_vault_a;
        deposit_amount = amount_a;

        withdrawal_account_user = token_owner_account_b;
        withdrawal_account_pool = token_vault_b;
        withdrawal_amount = amount_b;
    } else {
        deposit_account_user = token_owner_account_b;
        deposit_account_pool = token_vault_b;
        deposit_amount = amount_b;

        withdrawal_account_user = token_owner_account_a;
        withdrawal_account_pool = token_vault_a;
        withdrawal_amount = amount_a;
    }

    transfer_from_owner_to_vault(
        token_authority,
        deposit_account_user,
        deposit_account_pool,
        token_program,
        deposit_amount,
    )?;

    transfer_from_vault_to_owner(
        whirlpool,
        withdrawal_account_pool,
        withdrawal_account_user,
        token_program,
        withdrawal_amount,
    )?;

    Ok(())
}
