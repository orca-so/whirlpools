use crate::{state::*, util::transfer_from_vault_to_owner};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

#[derive(Accounts)]
pub struct CollectProtocolFees<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    #[account(mut, has_one = whirlpools_config)]
    pub whirlpool: AccountLoader<'info, Whirlpool>,

    #[account(address = whirlpools_config.collect_protocol_fees_authority)]
    pub collect_protocol_fees_authority: Signer<'info>,

    #[account(mut, address = whirlpool.load()?.token_vault_a)]
    pub token_vault_a: Account<'info, TokenAccount>,

    #[account(mut, address = whirlpool.load()?.token_vault_b)]
    pub token_vault_b: Account<'info, TokenAccount>,

    #[account(mut, constraint = token_destination_a.mint == whirlpool.load()?.token_mint_a)]
    pub token_destination_a: Account<'info, TokenAccount>,

    #[account(mut, constraint = token_destination_b.mint == whirlpool.load()?.token_mint_b)]
    pub token_destination_b: Account<'info, TokenAccount>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CollectProtocolFees>) -> Result<()> {
    let whirlpool = &mut *ctx.accounts.whirlpool.load_mut()?;

    transfer_from_vault_to_owner(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_destination_a,
        &ctx.accounts.token_program,
        whirlpool.protocol_fee_owed_a,
    )?;

    transfer_from_vault_to_owner(
        &ctx.accounts.whirlpool,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_destination_b,
        &ctx.accounts.token_program,
        whirlpool.protocol_fee_owed_b,
    )?;

    Ok(whirlpool.reset_protocol_fees_owed())
}
