use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::Whirlpool;

#[derive(Accounts)]
#[instruction(reward_index: u8)]
pub struct InitializeRewardV2<'info> {
    #[account(address = whirlpool.reward_infos[reward_index as usize].authority)]
    pub reward_authority: Signer<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(mut)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = funder,
        token::token_program = token_program,
        token::mint = reward_mint,
        token::authority = whirlpool
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeRewardV2>, reward_index: u8) -> Result<()> {
    let whirlpool = &mut ctx.accounts.whirlpool;

    Ok(whirlpool.initialize_reward(
        reward_index as usize,
        ctx.accounts.reward_mint.key(),
        ctx.accounts.reward_vault.key(),
    )?)
}
