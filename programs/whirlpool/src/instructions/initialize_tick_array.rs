use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
#[instruction(start_tick_index: i32)]
pub struct InitializeTickArray<'info> {
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
      init,
      payer = funder,
      seeds = [b"tick_array", whirlpool.key().as_ref(), start_tick_index.to_string().as_bytes()],
      bump,
      space = TickArray::LEN)]
    pub tick_array: AccountLoader<'info, TickArray>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeTickArray>, start_tick_index: i32) -> Result<()> {
    let mut tick_array = ctx.accounts.tick_array.load_init()?;
    tick_array.initialize(&ctx.accounts.whirlpool, start_tick_index)
}
