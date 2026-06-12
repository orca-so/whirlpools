use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
#[instruction(nonce: u8)]
pub struct InitializePreparedSwap<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
      init,
      payer = funder,
      seeds = [b"prepared_swap", nonce.to_le_bytes().as_ref()],
      bump,
      space = PreparedSwap::LEN)]
    pub prepared_swap: AccountLoader<'info, PreparedSwap>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePreparedSwap>, nonce: u8) -> Result<()> {
    let mut prepared_swap = ctx.accounts.prepared_swap.load_init()?;
    prepared_swap.initialize(nonce)
}
