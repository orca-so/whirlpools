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
