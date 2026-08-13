use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token};

use crate::{state::Whirlpool, util::initialize_vault_token_account};

#[derive(Accounts)]
pub struct InitializeReward<'info> {
    #[account(address = whirlpool.reward_authority())]
    pub reward_authority: Signer<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(mut)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    pub reward_mint: Box<Account<'info, Mint>>,

    /// CHECK: initialized in the handler
    #[account(mut)]
    pub reward_vault: Signer<'info>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeReward>, reward_index: u8) -> Result<()> {
    let whirlpool = &mut ctx.accounts.whirlpool;

    initialize_vault_token_account(
        whirlpool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.reward_mint.to_account_info(),
        &ctx.accounts.funder,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
    )?;

    whirlpool.initialize_reward(
        reward_index as usize,
        ctx.accounts.reward_mint.key(),
        ctx.accounts.reward_vault.key(),
    )
}
