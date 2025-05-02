use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[derive(Accounts)]
pub struct InitializeTokenBadge<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(has_one = whirlpools_config)]
    pub whirlpools_config_extension: Box<Account<'info, WhirlpoolsConfigExtension>>,

    #[account(address = whirlpools_config_extension.token_badge_authority)]
    pub token_badge_authority: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(init,
      payer = funder,
      seeds = [
        b"token_badge",
        whirlpools_config.key().as_ref(),
        token_mint.key().as_ref(),
      ],
      bump,
      space = TokenBadge::LEN)]
    pub token_badge: Account<'info, TokenBadge>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeTokenBadge>) -> Result<()> {
    ctx.accounts.token_badge.initialize(
        ctx.accounts.whirlpools_config.key(),
        ctx.accounts.token_mint.key(),
    )
}
