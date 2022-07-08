use crate::state::WhirlpoolsConfig;
use crate::{errors::ErrorCode, math::MAX_FEE_RATE};
use anchor_lang::prelude::*;

#[account]
pub struct FeeTier {
    pub whirlpools_config: Pubkey,
    pub tick_spacing: u16,
    pub default_fee_rate: u16,
}

impl FeeTier {
    pub const LEN: usize = 8 + 32 + 4;

    pub fn initialize(
        &mut self,
        whirlpools_config: &Account<WhirlpoolsConfig>,
        tick_spacing: u16,
        default_fee_rate: u16,
    ) -> Result<()> {
        self.whirlpools_config = whirlpools_config.key();
        self.tick_spacing = tick_spacing;
        self.update_default_fee_rate(default_fee_rate)?;
        Ok(())
    }

    pub fn update_default_fee_rate(&mut self, default_fee_rate: u16) -> Result<()> {
        if default_fee_rate > MAX_FEE_RATE {
            return Err(ErrorCode::FeeRateMaxExceeded.into());
        }
        self.default_fee_rate = default_fee_rate;

        Ok(())
    }
}
