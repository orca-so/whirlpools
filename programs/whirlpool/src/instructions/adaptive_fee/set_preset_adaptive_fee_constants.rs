use anchor_lang::prelude::*;

use crate::state::{AdaptiveFeeTier, WhirlpoolsConfig};

#[derive(Accounts)]
pub struct SetPresetAdaptiveFeeConstants<'info> {
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, has_one = whirlpools_config)]
    pub adaptive_fee_tier: Account<'info, AdaptiveFeeTier>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetPresetAdaptiveFeeConstants>,
    filter_period: u16,
    decay_period: u16,
    reduction_factor: u16,
    adaptive_fee_control_factor: u32,
    max_volatility_accumulator: u32,
    tick_group_size: u16,
) -> Result<()> {
    ctx.accounts
        .adaptive_fee_tier
        .update_adaptive_fee_constants(
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        )
}
