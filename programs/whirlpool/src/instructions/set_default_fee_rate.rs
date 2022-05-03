use anchor_lang::prelude::*;

use crate::state::{FeeTier, WhirlpoolsConfig};

#[derive(Accounts)]
pub struct SetDefaultFeeRate<'info> {
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, has_one = whirlpools_config)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

/*
   Updates the default fee rate on a FeeTier object.
*/
pub fn handler(ctx: Context<SetDefaultFeeRate>, default_fee_rate: u16) -> ProgramResult {
    Ok(ctx
        .accounts
        .fee_tier
        .update_default_fee_rate(default_fee_rate)?)
}
