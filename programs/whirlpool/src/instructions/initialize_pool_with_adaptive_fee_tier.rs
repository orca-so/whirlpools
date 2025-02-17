use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ErrorCode,
    state::*,
    util::{is_token_badge_initialized, v2::is_supported_token_mint},
};

#[derive(Accounts)]
pub struct InitializePoolWithAdaptiveFeeTier<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(seeds = [b"token_badge", whirlpools_config.key().as_ref(), token_mint_a.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_a: UncheckedAccount<'info>,
    #[account(seeds = [b"token_badge", whirlpools_config.key().as_ref(), token_mint_b.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_b: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(constraint = adaptive_fee_tier.is_valid_initialize_pool_authority(initialize_pool_authority.key()))]
    pub initialize_pool_authority: Signer<'info>,

    #[account(init,
      seeds = [
        b"whirlpool".as_ref(),
        whirlpools_config.key().as_ref(),
        token_mint_a.key().as_ref(),
        token_mint_b.key().as_ref(),
        adaptive_fee_tier.fee_tier_index.to_le_bytes().as_ref()
      ],
      bump,
      payer = funder,
      space = Whirlpool::LEN)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(
        init,
        payer = funder,
        seeds = [b"oracle", whirlpool.key().as_ref()],
        bump,
        space = Oracle::LEN)]
    pub oracle: AccountLoader<'info, Oracle>,
  
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
    pub adaptive_fee_tier: Account<'info, AdaptiveFeeTier>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePoolWithAdaptiveFeeTier>,
    initial_sqrt_price: u128,
) -> Result<()> {
    let token_mint_a = ctx.accounts.token_mint_a.key();
    let token_mint_b = ctx.accounts.token_mint_b.key();

    let whirlpool = &mut ctx.accounts.whirlpool;
    let whirlpools_config = &ctx.accounts.whirlpools_config;

    let fee_tier_index = ctx.accounts.adaptive_fee_tier.fee_tier_index;

    let tick_spacing = ctx.accounts.adaptive_fee_tier.tick_spacing;

    let default_fee_rate = ctx.accounts.adaptive_fee_tier.default_base_fee_rate;

    // ignore the bump passed and use one Anchor derived
    let bump = ctx.bumps.whirlpool;

    // Don't allow creating a pool with unsupported token mints
    let is_token_badge_initialized_a = is_token_badge_initialized(
        whirlpools_config.key(),
        token_mint_a,
        &ctx.accounts.token_badge_a,
    )?;

    if !is_supported_token_mint(&ctx.accounts.token_mint_a, is_token_badge_initialized_a).unwrap() {
        return Err(ErrorCode::UnsupportedTokenMint.into());
    }

    let is_token_badge_initialized_b = is_token_badge_initialized(
        whirlpools_config.key(),
        token_mint_b,
        &ctx.accounts.token_badge_b,
    )?;

    if !is_supported_token_mint(&ctx.accounts.token_mint_b, is_token_badge_initialized_b).unwrap() {
        return Err(ErrorCode::UnsupportedTokenMint.into());
    }

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
    )?;

    let mut oracle = ctx.accounts.oracle.load_init()?;
    oracle.initialize(
        ctx.accounts.whirlpool.key(),
        tick_spacing,
        ctx.accounts.adaptive_fee_tier.filter_period,
        ctx.accounts.adaptive_fee_tier.decay_period,
        ctx.accounts.adaptive_fee_tier.reduction_factor,
        ctx.accounts
            .adaptive_fee_tier
            .adaptive_fee_control_factor,
        ctx.accounts
            .adaptive_fee_tier
            .max_volatility_accumulator,
        ctx.accounts.adaptive_fee_tier.tick_group_size,
    )
}
