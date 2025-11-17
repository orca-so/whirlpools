use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::*;

#[derive(Accounts)]
pub struct RepositionLiquidityV2<'info> {
    #[account(mut)]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,

    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,

    pub position_authority: Signer<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(mut, has_one = whirlpool)]
    pub position: Account<'info, Position>,

    #[account(
        constraint = position_token_account.mint == position.position_mint,
        constraint = position_token_account.amount == 1
    )]
    pub position_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = whirlpool.token_mint_a)]
    pub token_mint_a: InterfaceAccount<'info, Mint>,

    #[account(address = whirlpool.token_mint_b)]
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_vault_a.key() == whirlpool.token_vault_a)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_vault_b.key() == whirlpool.token_vault_b)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub existing_tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub existing_tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub new_tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: Checked by the tick array loader
    #[account(mut)]
    pub new_tick_array_upper: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub enum RepositionLiquidityMethod {
    ByLiquidity {
        new_liquidity_amount: u128,
        existing_range_token_min_a: u64,
        existing_range_token_min_b: u64,
        new_range_token_max_a: u64,
        new_range_token_max_b: u64,
    },
}
