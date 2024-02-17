use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
  errors::ErrorCode,
  state::*,
  util::v2::is_supported_token_mint
};

#[derive(Accounts)]
#[instruction(tick_spacing: u16)]
pub struct InitializePoolV2<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

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
      token::token_program = token_program_a,
      token::mint = token_mint_a,
      token::authority = whirlpool)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_b,
      token::mint = token_mint_b,
      token::authority = whirlpool)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(has_one = whirlpools_config)]
    pub fee_tier: Account<'info, FeeTier>,

    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePoolV2>,
    tick_spacing: u16,
    initial_sqrt_price: u128,
) -> Result<()> {
    let token_mint_a = ctx.accounts.token_mint_a.key();
    let token_mint_b = ctx.accounts.token_mint_b.key();

    let whirlpool = &mut ctx.accounts.whirlpool;
    let whirlpools_config = &ctx.accounts.whirlpools_config;

    let default_fee_rate = ctx.accounts.fee_tier.default_fee_rate;

    // ignore the bump passed and use one Anchor derived
    let bump = ctx.bumps.whirlpool;

    // Don't allow creating a pool with unsupported token mints
    if !is_supported_token_mint(&ctx.accounts.token_mint_a).unwrap() {
      return Err(ErrorCode::UnsupportedTokenMint.into());
    }
    if !is_supported_token_mint(&ctx.accounts.token_mint_b).unwrap() {
      return Err(ErrorCode::UnsupportedTokenMint.into());
    }

    Ok(whirlpool.initialize(
        whirlpools_config,
        bump,
        tick_spacing,
        initial_sqrt_price,
        default_fee_rate,
        token_mint_a,
        ctx.accounts.token_vault_a.key(),
        token_mint_b,
        ctx.accounts.token_vault_b.key(),
    )?)
}
