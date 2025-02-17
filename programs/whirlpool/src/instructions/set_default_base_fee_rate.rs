use anchor_lang::prelude::*;

use crate::state::{AdaptiveFeeTier, WhirlpoolsConfig};

#[derive(Accounts)]
pub struct SetDefaultBaseFeeRate<'info> {
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, has_one = whirlpools_config)]
    pub adaptive_fee_tier: Account<'info, AdaptiveFeeTier>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetDefaultBaseFeeRate>, default_base_fee_rate: u16) -> Result<()> {
    ctx.accounts.adaptive_fee_tier.update_default_base_fee_rate(default_base_fee_rate)
}
