use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

use crate::{manager::swap_manager::PostSwapUpdate, state::Whirlpool};

use super::{transfer_from_owner_to_vault_v2, transfer_from_vault_to_owner_v2};

pub fn update_and_swap_whirlpool_v2<'info>(
    whirlpool: &mut AccountLoader<'info, Whirlpool>,
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
    whirlpool.load_mut()?.update_after_swap(
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
    whirlpool: &AccountLoader<'info, Whirlpool>,
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
    // update
    swap_update_one: PostSwapUpdate,
    swap_update_two: PostSwapUpdate,
    // whirlpool
    whirlpool_one: &mut AccountLoader<'info, Whirlpool>,
    whirlpool_two: &mut AccountLoader<'info, Whirlpool>,
    // direction
    is_token_fee_in_one_a: bool,
    is_token_fee_in_two_a: bool,
    // mint
    token_mint_input: &InterfaceAccount<'info, Mint>,
    token_mint_intermediate: &InterfaceAccount<'info, Mint>,
    token_mint_output: &InterfaceAccount<'info, Mint>,
    // token program
    token_program_input: &Interface<'info, TokenInterface>,
    token_program_intermediate: &Interface<'info, TokenInterface>,
    token_program_output: &Interface<'info, TokenInterface>,
    // token accounts
    token_owner_account_input: &InterfaceAccount<'info, TokenAccount>,
    token_vault_one_input: &InterfaceAccount<'info, TokenAccount>,
    token_vault_one_intermediate: &InterfaceAccount<'info, TokenAccount>,
    token_vault_two_intermediate: &InterfaceAccount<'info, TokenAccount>,
    token_vault_two_output: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account_output: &InterfaceAccount<'info, TokenAccount>,
    // hook
    transfer_hook_accounts_input: &Option<Vec<AccountInfo<'info>>>,
    transfer_hook_accounts_intermediate: &Option<Vec<AccountInfo<'info>>>,
    transfer_hook_accounts_output: &Option<Vec<AccountInfo<'info>>>,
    // common
    token_authority: &Signer<'info>,
    memo_program: &Program<'info, Memo>,
    reward_last_updated_timestamp: u64,
    memo: &[u8],
) -> Result<()> {
    whirlpool_one.load_mut()?.update_after_swap(
        swap_update_one.next_liquidity,
        swap_update_one.next_tick_index,
        swap_update_one.next_sqrt_price,
        swap_update_one.next_fee_growth_global,
        swap_update_one.next_reward_infos,
        swap_update_one.next_protocol_fee,
        is_token_fee_in_one_a,
        reward_last_updated_timestamp,
    );

    whirlpool_two.load_mut()?.update_after_swap(
        swap_update_two.next_liquidity,
        swap_update_two.next_tick_index,
        swap_update_two.next_sqrt_price,
        swap_update_two.next_fee_growth_global,
        swap_update_two.next_reward_infos,
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
    let output_amount = if is_token_fee_in_two_a { swap_update_two.amount_b } else { swap_update_two.amount_a };

    transfer_from_owner_to_vault_v2(
        token_authority,
        token_mint_input,
        token_owner_account_input,
        token_vault_one_input,
        token_program_input,
        memo_program,
        transfer_hook_accounts_input,
        input_amount,
    )?;

    // Transfer from pool to pool
    transfer_from_vault_to_owner_v2(
        whirlpool_one,
        token_mint_intermediate,
        token_vault_one_intermediate,
        token_vault_two_intermediate,
        token_program_intermediate,
        memo_program,
        transfer_hook_accounts_intermediate,
        intermediate_amount,
        memo,
    )?;

    transfer_from_vault_to_owner_v2(
        whirlpool_two,
        token_mint_output,
        token_vault_two_output,
        token_owner_account_output,
        token_program_output,
        memo_program,
        transfer_hook_accounts_output,
        output_amount,
        memo,
    )?;

    Ok(())
}
