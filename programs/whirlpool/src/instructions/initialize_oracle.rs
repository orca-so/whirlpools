/* 
use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
      init,
      payer = funder,
      seeds = [b"oracle", whirlpool.key().as_ref()],
      bump,
      space = Oracle::LEN)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(
      constraint = adaptive_fee_config.whirlpools_config == whirlpool.whirlpools_config,
      constraint = adaptive_fee_config.tick_spacing == whirlpool.tick_spacing,
    )]
    pub adaptive_fee_config: Account<'info, AdaptiveFeeTier>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeOracle>) -> Result<()> {
    let mut oracle = ctx.accounts.oracle.load_init()?;
    oracle.initialize(
        &ctx.accounts.whirlpool,
        ctx.accounts.adaptive_fee_config.default_filter_period,
        ctx.accounts.adaptive_fee_config.default_decay_period,
        ctx.accounts.adaptive_fee_config.default_reduction_factor,
        ctx.accounts
            .adaptive_fee_config
            .default_adaptive_fee_control_factor,
        ctx.accounts
            .adaptive_fee_config
            .default_max_volatility_accumulator,
        ctx.accounts.adaptive_fee_config.default_tick_group_size,
    )
}
*/