use anchor_lang::prelude::*;

use crate::state::Whirlpool;

#[derive(Accounts)]
#[instruction(reward_index: u8)]
pub struct SetRewardAuthority<'info> {
    #[account(mut)]
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(address = whirlpool.reward_infos[reward_index as usize].authority)]
    pub reward_authority: Signer<'info>,

    pub new_reward_authority: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SetRewardAuthority>, reward_index: u8) -> ProgramResult {
    Ok(ctx.accounts.whirlpool.update_reward_authority(
        reward_index as usize,
        ctx.accounts.new_reward_authority.key(),
    )?)
}
