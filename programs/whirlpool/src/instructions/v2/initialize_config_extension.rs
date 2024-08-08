use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeConfigExtension<'info> {
    pub config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(init,
      payer = funder,
      seeds = [
        b"config_extension",
        config.key().as_ref(),
      ],
      bump,
      space = WhirlpoolsConfigExtension::LEN)]
    pub config_extension: Account<'info, WhirlpoolsConfigExtension>,

    #[account(mut)]
    pub funder: Signer<'info>,

    // fee_authority can initialize config extension
    #[account(address = config.fee_authority)]
    pub fee_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfigExtension>) -> Result<()> {
    ctx.accounts
        .config_extension
        .initialize(ctx.accounts.config.key(), ctx.accounts.fee_authority.key())
}
