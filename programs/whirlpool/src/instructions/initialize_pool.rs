use crate::{events::*, state::*};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[derive(Accounts)]
// now we don't use bumps, but we must list args in the same order to use tick_spacing arg.
#[instruction(bumps: WhirlpoolBumps, tick_spacing: u16)]
pub struct InitializePool<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(init,
      seeds = [
        b"whirlpool".as_ref(),
        whirlpools_config.key().as_ref(),
        token_mint_a.key().as_ref(),
        token_mint_b.key().as_ref(),
        tick_spacing.to_le_bytes().as_ref()
      ],
      bump,
      payer = funder,
      space = Whirlpool::LEN)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(init,
      payer = funder,
      token::mint = token_mint_a,
      token::authority = whirlpool)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(init,
      payer = funder,
      token::mint = token_mint_b,
      token::authority = whirlpool)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    #[account(has_one = whirlpools_config, constraint = fee_tier.tick_spacing == tick_spacing)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePool>,
    _bumps: WhirlpoolBumps,
    tick_spacing: u16,
    initial_sqrt_price: u128,
) -> Result<()> {
    let token_mint_a = ctx.accounts.token_mint_a.key();
    let token_mint_b = ctx.accounts.token_mint_b.key();

    let whirlpool = &mut ctx.accounts.whirlpool;
    let whirlpools_config = &ctx.accounts.whirlpools_config;

    let fee_tier_index = tick_spacing;

    let default_fee_rate = ctx.accounts.fee_tier.default_fee_rate;

    // ignore the bump passed and use one Anchor derived
    let bump = ctx.bumps.whirlpool;

    whirlpool.initialize(
        whirlpools_config,
        fee_tier_index,
        bump,
        tick_spacing,
        initial_sqrt_price,
        default_fee_rate,
        token_mint_a,
        ctx.accounts.token_vault_a.key(),
        token_mint_b,
        ctx.accounts.token_vault_b.key(),
        WhirlpoolControlFlags::empty(),
    )?;

    emit!(PoolInitialized {
        whirlpool: ctx.accounts.whirlpool.key(),
        whirlpools_config: ctx.accounts.whirlpools_config.key(),
        token_mint_a: ctx.accounts.token_mint_a.key(),
        token_mint_b: ctx.accounts.token_mint_b.key(),
        tick_spacing,
        token_program_a: ctx.accounts.token_program.key(),
        token_program_b: ctx.accounts.token_program.key(),
        decimals_a: ctx.accounts.token_mint_a.decimals,
        decimals_b: ctx.accounts.token_mint_b.decimals,
        initial_sqrt_price,
    });

    Ok(())
}
