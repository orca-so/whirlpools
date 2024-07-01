use anchor_lang::prelude::*;

use crate::state::{Whirlpool, WhirlpoolsConfig};

#[derive(Accounts)]
#[instruction(reward_index: u8)]
pub struct SetRewardAuthorityBySuperAuthority<'info> {
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(mut, has_one = whirlpools_config)]
    pub whirlpool: AccountLoader<'info, Whirlpool>,

    #[account(address = whirlpools_config.reward_emissions_super_authority)]
    pub reward_emissions_super_authority: Signer<'info>,

    /// CHECK: safe, the account that will be new authority can be arbitrary
    pub new_reward_authority: UncheckedAccount<'info>,
}

/// Set the whirlpool reward authority at the provided `reward_index`.
/// Only the current reward emissions super authority has permission to invoke this instruction.
pub fn handler(ctx: Context<SetRewardAuthorityBySuperAuthority>, reward_index: u8) -> Result<()> {
    Ok(ctx.accounts.whirlpool.load_mut()?.update_reward_authority(
        reward_index as usize,
        ctx.accounts.new_reward_authority.key(),
    )?)
}
