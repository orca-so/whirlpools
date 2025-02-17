use anchor_lang::prelude::*;

use crate::state::{AdaptiveFeeTier, Whirlpool};

#[derive(Accounts)]
pub struct SetFeeRateByDelegatedFeeAuthority<'info> {
    #[account(mut,
        constraint = whirlpool.is_initialized_with_adaptive_fee_tier(),
    )]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(
        constraint = adaptive_fee_tier.whirlpools_config == whirlpool.whirlpools_config,
        constraint = adaptive_fee_tier.fee_tier_index == whirlpool.fee_tier_index(),
    )]
    pub adaptive_fee_tier: Account<'info, AdaptiveFeeTier>,

    #[account(address = adaptive_fee_tier.delegated_fee_authority)]
    pub delegated_fee_authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetFeeRateByDelegatedFeeAuthority>, fee_rate: u16) -> Result<()> {
    ctx.accounts.whirlpool.update_fee_rate(fee_rate)
}
