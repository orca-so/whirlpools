use anchor_lang::prelude::*;

use crate::state::WhirlpoolsConfig;

#[derive(Accounts)]
pub struct SetDefaultProtocolFeeRate<'info> {
    #[account(mut)]
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetDefaultProtocolFeeRate>,
    default_protocol_fee_rate: u16,
) -> Result<()> {
    Ok(ctx
        .accounts
        .whirlpools_config
        .update_default_protocol_fee_rate(default_protocol_fee_rate)?)
}
