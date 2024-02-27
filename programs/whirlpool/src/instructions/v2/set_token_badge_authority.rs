use anchor_lang::prelude::*;

use crate::state::WhirlpoolsConfigExtension;

#[derive(Accounts)]
pub struct SetTokenBadgeAuthority<'info> {
    #[account(mut)]
    pub whirlpools_config_extension: Account<'info, WhirlpoolsConfigExtension>,

    #[account(address = whirlpools_config_extension.token_badge_authority)]
    pub token_badge_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_token_badge_authority: UncheckedAccount<'info>,
}

/// Set the fee authority. Only the current fee authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetTokenBadgeAuthority>) -> Result<()> {
    Ok(ctx
        .accounts
        .whirlpools_config_extension
        .update_token_badge_authority(ctx.accounts.new_token_badge_authority.key()))
}
