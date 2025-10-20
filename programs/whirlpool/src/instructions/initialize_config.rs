use anchor_lang::prelude::*;

use crate::auth::admin::is_admin_key;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = funder, space = WhirlpoolsConfig::LEN)]
    pub config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, constraint = is_admin_key(funder.key))]
    pub funder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    fee_authority: Pubkey,
    collect_protocol_fees_authority: Pubkey,
    reward_emissions_super_authority: Pubkey,
    default_protocol_fee_rate: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.initialize(
        fee_authority,
        collect_protocol_fees_authority,
        reward_emissions_super_authority,
        default_protocol_fee_rate,
    )
}
