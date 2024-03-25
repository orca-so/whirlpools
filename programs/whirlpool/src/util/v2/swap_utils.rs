use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

use crate::{manager::swap_manager::PostSwapUpdate, state::Whirlpool};

use super::{transfer_from_owner_to_vault_v2, transfer_from_vault_to_owner_v2};

pub fn update_and_swap_whirlpool_v2<'info>(
    whirlpool: &mut Account<'info, Whirlpool>,
    token_authority: &Signer<'info>,
    token_mint_a: &InterfaceAccount<'info, Mint>,
    token_mint_b: &InterfaceAccount<'info, Mint>,
    token_owner_account_a: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_b: &InterfaceAccount<'info, TokenAccount>,
    token_vault_a: &InterfaceAccount<'info, TokenAccount>,
    token_vault_b: &InterfaceAccount<'info, TokenAccount>,
    transfer_hook_accounts_a: &Option<Vec<AccountInfo<'info>>>,
    transfer_hook_accounts_b: &Option<Vec<AccountInfo<'info>>>,
    token_program_a: &Interface<'info, TokenInterface>,
    token_program_b: &Interface<'info, TokenInterface>,
    memo_program: &Program<'info, Memo>,
    swap_update: PostSwapUpdate,
    is_token_fee_in_a: bool,
    reward_last_updated_timestamp: u64,
    memo: &[u8],
) -> Result<()> {
    whirlpool.update_after_swap(
        swap_update.next_liquidity,
        swap_update.next_tick_index,
        swap_update.next_sqrt_price,
        swap_update.next_fee_growth_global,
        swap_update.next_reward_infos,
        swap_update.next_protocol_fee,
        is_token_fee_in_a,
        reward_last_updated_timestamp,
    );

    perform_swap_v2(
        whirlpool,
        token_authority,
        token_mint_a,
        token_mint_b,
        token_owner_account_a,
        token_owner_account_b,
        token_vault_a,
        token_vault_b,
        transfer_hook_accounts_a,
        transfer_hook_accounts_b,
        token_program_a,
        token_program_b,
        memo_program,
        swap_update.amount_a,
        swap_update.amount_b,
        is_token_fee_in_a,
        memo,
    )
}

fn perform_swap_v2<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    token_authority: &Signer<'info>,
    token_mint_a: &InterfaceAccount<'info, Mint>,
    token_mint_b: &InterfaceAccount<'info, Mint>,
    token_owner_account_a: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_b: &InterfaceAccount<'info, TokenAccount>,
    token_vault_a: &InterfaceAccount<'info, TokenAccount>,
    token_vault_b: &InterfaceAccount<'info, TokenAccount>,
    transfer_hook_accounts_a: &Option<Vec<AccountInfo<'info>>>,
    transfer_hook_accounts_b: &Option<Vec<AccountInfo<'info>>>,
    token_program_a: &Interface<'info, TokenInterface>,
    token_program_b: &Interface<'info, TokenInterface>,
    memo_program: &Program<'info, Memo>,
    amount_a: u64,
    amount_b: u64,
    a_to_b: bool,
    memo: &[u8],
) -> Result<()> {
    // Transfer from user to pool
    let deposit_token_program;
    let deposit_mint;
    let deposit_account_user;
    let deposit_account_pool;
    let deposit_transfer_hook_accounts;
    let deposit_amount;

    // Transfer from pool to user
    let withdrawal_token_program;
    let withdrawal_mint;
    let withdrawal_account_user;
    let withdrawal_account_pool;
    let withdrawal_transfer_hook_accounts;
    let withdrawal_amount;

    if a_to_b {
        deposit_token_program = token_program_a;
        deposit_mint = token_mint_a;
        deposit_account_user = token_owner_account_a;
        deposit_account_pool = token_vault_a;
        deposit_transfer_hook_accounts = transfer_hook_accounts_a;
        deposit_amount = amount_a;

        withdrawal_token_program = token_program_b;
        withdrawal_mint = token_mint_b;
        withdrawal_account_user = token_owner_account_b;
        withdrawal_account_pool = token_vault_b;
        withdrawal_transfer_hook_accounts = transfer_hook_accounts_b;
        withdrawal_amount = amount_b;
    } else {
        deposit_token_program = token_program_b;
        deposit_mint = token_mint_b;
        deposit_account_user = token_owner_account_b;
        deposit_account_pool = token_vault_b;
        deposit_transfer_hook_accounts = transfer_hook_accounts_b;
        deposit_amount = amount_b;

        withdrawal_token_program = token_program_a;
        withdrawal_mint = token_mint_a;
        withdrawal_account_user = token_owner_account_a;
        withdrawal_account_pool = token_vault_a;
        withdrawal_transfer_hook_accounts = transfer_hook_accounts_a;
        withdrawal_amount = amount_a;
    }

    transfer_from_owner_to_vault_v2(
        token_authority,
        deposit_mint,
        deposit_account_user,
        deposit_account_pool,
        deposit_token_program,
        memo_program,
        deposit_transfer_hook_accounts,
        deposit_amount,
    )?;

    transfer_from_vault_to_owner_v2(
        whirlpool,
        withdrawal_mint,
        withdrawal_account_pool,
        withdrawal_account_user,
        withdrawal_token_program,
        memo_program,
        withdrawal_transfer_hook_accounts,
        withdrawal_amount,
        memo,
    )?;

    Ok(())
}

pub fn update_and_two_hop_swap_whirlpool_v2<'info>(
    // one
    swap_update_one: PostSwapUpdate,
    is_token_fee_in_one_a: bool,
    whirlpool_one: &mut Account<'info, Whirlpool>,
    token_mint_one_a: &InterfaceAccount<'info, Mint>,
    token_mint_one_b: &InterfaceAccount<'info, Mint>,
    token_owner_account_one_a: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_one_b: &InterfaceAccount<'info, TokenAccount>,
    token_vault_one_a: &InterfaceAccount<'info, TokenAccount>,
    token_vault_one_b: &InterfaceAccount<'info, TokenAccount>,
    transfer_hook_accounts_one_a: &Option<Vec<AccountInfo<'info>>>,
    transfer_hook_accounts_one_b: &Option<Vec<AccountInfo<'info>>>,
    token_program_one_a: &Interface<'info, TokenInterface>,
    token_program_one_b: &Interface<'info, TokenInterface>,
    // two
    swap_update_two: PostSwapUpdate,
    is_token_fee_in_two_a: bool,
    whirlpool_two: &mut Account<'info, Whirlpool>,
    token_mint_two_a: &InterfaceAccount<'info, Mint>,
    token_mint_two_b: &InterfaceAccount<'info, Mint>,
    token_owner_account_two_a: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_two_b: &InterfaceAccount<'info, TokenAccount>,
    token_vault_two_a: &InterfaceAccount<'info, TokenAccount>,
    token_vault_two_b: &InterfaceAccount<'info, TokenAccount>,
    transfer_hook_accounts_two_a: &Option<Vec<AccountInfo<'info>>>,
    transfer_hook_accounts_two_b: &Option<Vec<AccountInfo<'info>>>,
    token_program_two_a: &Interface<'info, TokenInterface>,
    token_program_two_b: &Interface<'info, TokenInterface>,
    // common
    token_authority: &Signer<'info>,
    memo_program: &Program<'info, Memo>,
    reward_last_updated_timestamp: u64,
    memo: &[u8],
) -> Result<()> {
    whirlpool_one.update_after_swap(
        swap_update_one.next_liquidity,
        swap_update_one.next_tick_index,
        swap_update_one.next_sqrt_price,
        swap_update_one.next_fee_growth_global,
        swap_update_one.next_reward_infos,
        swap_update_one.next_protocol_fee,
        is_token_fee_in_one_a,
        reward_last_updated_timestamp,
    );

    whirlpool_two.update_after_swap(
        swap_update_two.next_liquidity,
        swap_update_two.next_tick_index,
        swap_update_two.next_sqrt_price,
        swap_update_two.next_fee_growth_global,
        swap_update_two.next_reward_infos,
        swap_update_two.next_protocol_fee,
        is_token_fee_in_two_a,
        reward_last_updated_timestamp,
    );

    // Transfer from user to pool
    let deposit_token_authority = token_authority.clone();
    let deposit_token_program;
    let deposit_mint;
    let deposit_account_user;
    let deposit_account_pool;
    let deposit_transfer_hook_accounts;
    let deposit_amount;

    // Transfer from pool to pool
    let intermediate_token_authority = whirlpool_one.clone();
    let intermediate_token_program;
    let intermediate_mint;
    let intermediate_account_pool_one;
    let intermediate_account_pool_two;
    let intermediate_transfer_hook_accounts;
    let intermediate_amount;

    // Transfer from pool to user
    let withdrawal_token_authority = whirlpool_two.clone();
    let withdrawal_token_program;
    let withdrawal_mint;
    let withdrawal_account_user;
    let withdrawal_account_pool;
    let withdrawal_transfer_hook_accounts;
    let withdrawal_amount;


    if is_token_fee_in_one_a {
        deposit_token_program = token_program_one_a;
        deposit_mint = token_mint_one_a;
        deposit_account_user = token_owner_account_one_a;
        deposit_account_pool = token_vault_one_a;
        deposit_transfer_hook_accounts = transfer_hook_accounts_one_a;
        deposit_amount = swap_update_one.amount_a;

        intermediate_token_program = token_program_one_b;
        intermediate_mint = token_mint_one_b;
        intermediate_account_pool_one = token_vault_one_b;
        intermediate_transfer_hook_accounts = transfer_hook_accounts_one_b;
        intermediate_amount = swap_update_one.amount_b;
    } else {
        deposit_token_program = token_program_one_b;
        deposit_mint = token_mint_one_b;
        deposit_account_user = token_owner_account_one_b;
        deposit_account_pool = token_vault_one_b;
        deposit_transfer_hook_accounts = transfer_hook_accounts_one_b;
        deposit_amount = swap_update_one.amount_b;

        intermediate_token_program = token_program_one_a;
        intermediate_mint = token_mint_one_a;
        intermediate_account_pool_one = token_vault_one_a;
        intermediate_transfer_hook_accounts = transfer_hook_accounts_one_a;
        intermediate_amount = swap_update_one.amount_a;
    }

    if is_token_fee_in_two_a {
        withdrawal_token_program = token_program_two_b;
        withdrawal_mint = token_mint_two_b;
        withdrawal_account_user = token_owner_account_two_b;
        withdrawal_account_pool = token_vault_two_b;
        withdrawal_transfer_hook_accounts = transfer_hook_accounts_two_b;
        withdrawal_amount = swap_update_two.amount_b;
    
        intermediate_account_pool_two = token_vault_two_a;
    } else {
        withdrawal_token_program = token_program_two_a;
        withdrawal_mint = token_mint_two_a;
        withdrawal_account_user = token_owner_account_two_a;
        withdrawal_account_pool = token_vault_two_a;
        withdrawal_transfer_hook_accounts = transfer_hook_accounts_two_a;
        withdrawal_amount = swap_update_two.amount_a;

        intermediate_account_pool_two = token_vault_two_b;
    }

    transfer_from_owner_to_vault_v2(
        &deposit_token_authority,
        deposit_mint,
        deposit_account_user,
        deposit_account_pool,
        deposit_token_program,
        memo_program,
        deposit_transfer_hook_accounts,
        deposit_amount,
    )?;

    // Transfer from pool to pool
    transfer_from_vault_to_owner_v2(
        &intermediate_token_authority,
        intermediate_mint,
        intermediate_account_pool_one,
        intermediate_account_pool_two,
        intermediate_token_program,
        memo_program,
        intermediate_transfer_hook_accounts,
        intermediate_amount,
        memo,
    )?;

    transfer_from_vault_to_owner_v2(
        &withdrawal_token_authority,
        withdrawal_mint,
        withdrawal_account_pool,
        withdrawal_account_user,
        withdrawal_token_program,
        memo_program,
        withdrawal_transfer_hook_accounts,
        withdrawal_amount,
        memo,
    )?;

    Ok(())
}
