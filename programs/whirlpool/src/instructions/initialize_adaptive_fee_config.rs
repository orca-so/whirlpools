use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct InitializeAdaptiveFeeConfig<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(has_one = whirlpools_config)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(init,
      payer = funder,
      seeds = [
        b"adaptive_fee_config",
        whirlpools_config.key().as_ref(),
        fee_tier.tick_spacing.to_le_bytes().as_ref()
      ],
      bump,
      space = AdaptiveFeeConfig::LEN)]
    pub adaptive_fee_config: Account<'info, AdaptiveFeeConfig>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeAdaptiveFeeConfig>,
    default_filter_period: u16,
    default_decay_period: u16,
    default_reduction_factor: u16,
    default_adaptive_fee_control_factor: u32,
    default_max_volatility_accumulator: u32,
    default_tick_group_size: u16,
) -> Result<()> {
    ctx.accounts.adaptive_fee_config.initialize(
        &ctx.accounts.whirlpools_config,
        &ctx.accounts.fee_tier,
        default_filter_period,
        default_decay_period,
        default_reduction_factor,
        default_adaptive_fee_control_factor,
        default_max_volatility_accumulator,
        default_tick_group_size,
    )
}
