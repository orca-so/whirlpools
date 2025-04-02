use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(fee_tier_index: u16)]
pub struct InitializeAdaptiveFeeTier<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(init,
      payer = funder,
      seeds = [
        b"fee_tier", // this is same to FeeTier to block initialization of both FeeTier and AdaptiveFeeTier
        whirlpools_config.key().as_ref(),
        fee_tier_index.to_le_bytes().as_ref()
      ],
      bump,
      space = AdaptiveFeeTier::LEN)]
    pub adaptive_fee_tier: Account<'info, AdaptiveFeeTier>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitializeAdaptiveFeeTier>,
    fee_tier_index: u16,
    tick_spacing: u16,
    initialize_pool_authority: Pubkey,
    delegated_fee_authority: Pubkey,
    default_base_fee_rate: u16,
    filter_period: u16,
    decay_period: u16,
    reduction_factor: u16,
    adaptive_fee_control_factor: u32,
    max_volatility_accumulator: u32,
    tick_group_size: u16,
    major_swap_threshold_ticks: u16,
) -> Result<()> {
    ctx.accounts.adaptive_fee_tier.initialize(
        &ctx.accounts.whirlpools_config,
        fee_tier_index,
        tick_spacing,
        initialize_pool_authority,
        delegated_fee_authority,
        default_base_fee_rate,
        filter_period,
        decay_period,
        reduction_factor,
        adaptive_fee_control_factor,
        max_volatility_accumulator,
        tick_group_size,
        major_swap_threshold_ticks,
    )
}
