use anchor_lang::prelude::*;

use crate::state::WhirlpoolsConfig;

#[derive(Accounts)]
pub struct SetFeeAuthority<'info> {
    #[account(mut)]
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(address = whirlpools_config.fee_authority)]
    pub fee_authority: Signer<'info>,

    pub new_fee_authority: UncheckedAccount<'info>,
}

/// Set the fee authority. Only the current fee authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetFeeAuthority>) -> Result<()> {
    Ok(ctx
        .accounts
        .whirlpools_config
        .update_fee_authority(ctx.accounts.new_fee_authority.key()))
}
