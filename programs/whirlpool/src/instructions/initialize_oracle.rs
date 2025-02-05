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

    // TODO: use VolatilityAdjustedFeeTier ?
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeOracle>) -> Result<()> {
    let mut oracle = ctx.accounts.oracle.load_init()?;

    // TODO: determine how to initialize params (arg, via VA_FEE_TIER or Default, etc)
    let filter_period = 30;
    let decay_period = 600;
    let reduction_factor = 500;
    let adaptive_fee_control_factor = 4_000;
    let max_volatility_accumulator = 350_000;

    // TODO: splash pool should use more granular group size
    let tick_group_size = ctx.accounts.whirlpool.tick_spacing;

    oracle.initialize(
        &ctx.accounts.whirlpool,
        filter_period,
        decay_period,
        reduction_factor,
        adaptive_fee_control_factor,
        max_volatility_accumulator,
        tick_group_size,
    )
}
