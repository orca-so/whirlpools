use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[derive(Accounts)]
pub struct SetTokenBadgeAttribute<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(has_one = whirlpools_config)]
    pub whirlpools_config_extension: Box<Account<'info, WhirlpoolsConfigExtension>>,

    #[account(address = whirlpools_config_extension.token_badge_authority)]
    pub token_badge_authority: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, has_one = whirlpools_config, has_one = token_mint)]
    pub token_badge: Account<'info, TokenBadge>,
}

pub fn handler(ctx: Context<SetTokenBadgeAttribute>, attribute: TokenBadgeAttribute) -> Result<()> {
    ctx.accounts
        .whirlpools_config
        .verify_enabled_feature(ConfigFeatureFlags::TOKEN_BADGE)?;

    ctx.accounts.token_badge.update_attribute(attribute)
}
