use anchor_lang::prelude::*;

use crate::{
    errors::ErrorCode,
    state::{AdaptiveFeeConstants, Oracle, Whirlpool, WhirlpoolsConfig},
};

#[derive(Accounts)]
pub struct SetAdaptiveFeeConstants<'info> {
    #[account(has_one = whirlpools_config)]
    pub whirlpool: Account<'info, Whirlpool>,

    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, has_one = whirlpool)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<SetAdaptiveFeeConstants>,
    filter_period: Option<u16>,
    decay_period: Option<u16>,
    reduction_factor: Option<u16>,
    adaptive_fee_control_factor: Option<u32>,
    max_volatility_accumulator: Option<u32>,
    tick_group_size: Option<u16>,
    major_swap_threshold_ticks: Option<u16>,
) -> Result<()> {
    let whirlpool = &ctx.accounts.whirlpool;
    let mut oracle = ctx.accounts.oracle.load_mut()?;

    let existing_constants = oracle.adaptive_fee_constants;
    let updated_constants = AdaptiveFeeConstants {
        filter_period: filter_period.unwrap_or(existing_constants.filter_period),
        decay_period: decay_period.unwrap_or(existing_constants.decay_period),
        reduction_factor: reduction_factor.unwrap_or(existing_constants.reduction_factor),
        adaptive_fee_control_factor: adaptive_fee_control_factor
            .unwrap_or(existing_constants.adaptive_fee_control_factor),
        max_volatility_accumulator: max_volatility_accumulator
            .unwrap_or(existing_constants.max_volatility_accumulator),
        tick_group_size: tick_group_size.unwrap_or(existing_constants.tick_group_size),
        major_swap_threshold_ticks: major_swap_threshold_ticks
            .unwrap_or(existing_constants.major_swap_threshold_ticks),
        reserved: [0u8; 16],
    };

    if updated_constants == existing_constants {
        return Err(ErrorCode::AdaptiveFeeConstantsUnchanged.into());
    }

    oracle.initialize_adaptive_fee_constants(updated_constants, whirlpool.tick_spacing)?;
    oracle.reset_adaptive_fee_variables();

    Ok(())
}
