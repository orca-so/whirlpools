use anchor_lang::prelude::*;

use crate::auth::admin::is_admin_key;
use crate::state::{ConfigFeatureFlag, WhirlpoolsConfig};

#[derive(Accounts)]
pub struct SetConfigFeatureFlag<'info> {
    #[account(mut)]
    pub whirlpools_config: Account<'info, WhirlpoolsConfig>,

    #[account(constraint = is_admin_key(authority.key))]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetConfigFeatureFlag>, feature_flag: ConfigFeatureFlag) -> Result<()> {
    ctx.accounts
        .whirlpools_config
        .update_feature_flags(feature_flag)
}
