use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct SetDefaultAdaptiveFeeConstants<'info> {
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, has_one = whirlpools_config)]
    pub adaptive_fee_config: Account<'info, AdaptiveFeeConfig>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

/*
   Updates the default constants for adaptive fee on an AdaptiveFeeConfig account.
*/
pub fn handler(
    ctx: Context<SetDefaultAdaptiveFeeConstants>,
    default_filter_period: u16,
    default_decay_period: u16,
    default_reduction_factor: u16,
    default_adaptive_fee_control_factor: u32,
    default_max_volatility_accumulator: u32,
    default_tick_group_size: u16,
) -> Result<()> {
    ctx.accounts
        .adaptive_fee_config
        .update_adaptive_fee_constants(
            default_filter_period,
            default_decay_period,
            default_reduction_factor,
            default_adaptive_fee_control_factor,
            default_max_volatility_accumulator,
            default_tick_group_size,
        )
}
