use anchor_lang::prelude::*;

use crate::state::{WhirlpoolsConfig, WhirlpoolsConfigExtension};

#[derive(Accounts)]
pub struct SetTokenBadgeAuthority<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(mut, has_one = whirlpools_config)]
    pub whirlpools_config_extension: Account<'info, WhirlpoolsConfigExtension>,

    #[account(address = whirlpools_config_extension.config_extension_authority)]
    pub config_extension_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_token_badge_authority: UncheckedAccount<'info>,
}

/// Set the token badge authority. Only the config extension authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetTokenBadgeAuthority>) -> Result<()> {
    ctx.accounts
        .whirlpools_config_extension
        .update_token_badge_authority(ctx.accounts.new_token_badge_authority.key());
    Ok(())
}
