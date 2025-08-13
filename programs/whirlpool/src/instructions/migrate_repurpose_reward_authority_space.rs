use anchor_lang::prelude::*;

use crate::state::Whirlpool;

#[derive(Accounts)]
pub struct MigrateRepurposeRewardAuthoritySpace<'info> {
    #[account(mut)]
    pub whirlpool: Account<'info, Whirlpool>,
}

pub fn handler(ctx: Context<MigrateRepurposeRewardAuthoritySpace>) -> Result<()> {
    let whirlpool = &mut ctx.accounts.whirlpool;

    // Check if the whirlpool has already been migrated
    //
    // Notes: Whirlpool accounts with reward_infos[2].authority equal to [0u8; 32]
    // do NOT exist on the four networks where the Whirlpool program is deployed.
    if whirlpool.reward_infos[2].extension == [0u8; 32] {
        panic!("Whirlpool has been migrated already");
    }

    // Migrate the reward authority space
    whirlpool.reward_infos[1].extension = [0u8; 32];
    whirlpool.reward_infos[2].extension = [0u8; 32];

    Ok(())
}
