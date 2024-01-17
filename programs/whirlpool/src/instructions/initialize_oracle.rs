use anchor_lang::prelude::*;

use crate::{state::*, util::to_timestamp_u64};

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
      init,
      payer = funder,
      seeds = [b"oracle", whirlpool.key().as_ref()],
      bump,
      space = Oracle::LEN,
    )]
    pub oracle: AccountLoader<'info, Oracle>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeOracle>) -> Result<()>
{
    let mut oracle = ctx.accounts.oracle.load_init()?;
    let clock = Clock::get()?;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;
    oracle.initialize(ctx.accounts.whirlpool.key(), timestamp as u32);
    Ok(())
}
