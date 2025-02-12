use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct SetAdaptiveFeeConstants<'info> {
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(has_one = whirlpools_config)]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(mut, has_one = whirlpool)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

/*
   Updates the default constants for adaptive fee on an AdaptiveFeeConfig account.
*/
pub fn handler(
    ctx: Context<SetAdaptiveFeeConstants>,
    filter_period: u16,
    decay_period: u16,
    reduction_factor: u16,
    adaptive_fee_control_factor: u32,
    max_volatility_accumulator: u32,
    tick_group_size: u16,
) -> Result<()> {
    let constants = AdaptiveFeeConstants {
        filter_period,
        decay_period,
        reduction_factor,
        adaptive_fee_control_factor,
        max_volatility_accumulator,
        tick_group_size,
    };

    ctx.accounts
        .oracle
        .load_mut()?
        .update_adaptive_fee_constants(constants, ctx.accounts.whirlpool.tick_spacing)
}
