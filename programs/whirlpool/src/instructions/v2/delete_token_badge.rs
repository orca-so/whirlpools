use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[derive(Accounts)]
pub struct DeleteTokenBadge<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(has_one = whirlpools_config)]
    pub whirlpools_config_extension: Box<Account<'info, WhirlpoolsConfigExtension>>,

    #[account(address = whirlpools_config_extension.token_badge_authority)]
    pub token_badge_authority: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
      mut,
      seeds = [
        b"token_badge",
        whirlpools_config.key().as_ref(),
        token_mint.key().as_ref(),
      ],
      bump,
      has_one = whirlpools_config,
      close = receiver
    )]
    pub token_badge: Account<'info, TokenBadge>,

    /// CHECK: safe, for receiving rent only
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<DeleteTokenBadge>) -> Result<()> {
    ctx.accounts
        .whirlpools_config
        .verify_enabled_feature(ConfigFeatureFlags::TOKEN_BADGE)?;

    Ok(())
}
