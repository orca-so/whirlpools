use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DeleteTokenBadge<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(has_one = whirlpools_config)]
    pub whirlpools_config_extension: Box<Account<'info, WhirlpoolsConfigExtension>>,

    #[account(address = whirlpools_config_extension.token_badge_authority)]
    pub token_badge_authority: Signer<'info>,

    #[account(
      mut,
      has_one = whirlpools_config,
      close = receiver
    )]
    pub token_badge: Account<'info, TokenBadge>,

    /// CHECK: safe, for receiving rent only
    #[account(mut)]
    pub receiver: UncheckedAccount<'info>,
}

pub fn handler(
    _ctx: Context<DeleteTokenBadge>,
) -> Result<()> {
    Ok(())
}
