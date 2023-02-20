use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Token};

use crate::{
    manager::swap_manager::PostSwapUpdate, state::Whirlpool
};

use super::{transfer_from_owner_to_vault, transfer_from_vault_to_owner};

pub fn update_and_swap_whirlpool<'info>(
    whirlpool: &mut Account<'info, Whirlpool>,
    token_authority: &Signer<'info>,
    token_owner_account_a: &Account<'info, TokenAccount>,
    token_owner_account_b: &Account<'info, TokenAccount>,
    token_vault_a: &Account<'info, TokenAccount>,
    token_vault_b: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    swap_update: PostSwapUpdate,
    is_token_fee_in_a: bool,
    reward_last_updated_timestamp: u64,
) -> ProgramResult {
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

    perform_swap(
        whirlpool,
        token_authority,
        token_owner_account_a,
        token_owner_account_b,
        token_vault_a,
        token_vault_b,
        token_program,
        swap_update.amount_a,
        swap_update.amount_b,
        is_token_fee_in_a,
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
