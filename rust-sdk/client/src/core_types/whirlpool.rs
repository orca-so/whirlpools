use orca_whirlpools_core::{WhirlpoolFacade, WhirlpoolRewardInfoFacade};

use crate::{accounts::Whirlpool, generated::types::WhirlpoolRewardInfo};

impl Into<WhirlpoolFacade> for Whirlpool {
  fn into(self) -> WhirlpoolFacade {
    WhirlpoolFacade {
      tick_spacing: self.tick_spacing,
      fee_rate: self.fee_rate,
      liquidity: self.liquidity,
      sqrt_price: self.sqrt_price,
      tick_current_index: self.tick_current_index,
      fee_growth_global_a: self.fee_growth_global_a,
      fee_growth_global_b: self.fee_growth_global_b,
      reward_last_updated_timestamp: self.reward_last_updated_timestamp,
      reward_infos: self.reward_infos.map(|info| info.into()),
    }
  }
}

impl Into<WhirlpoolRewardInfoFacade> for WhirlpoolRewardInfo {
  fn into(self) -> WhirlpoolRewardInfoFacade {
    WhirlpoolRewardInfoFacade {
      emissions_per_second_x64: self.emissions_per_second_x64,
      growth_global_x64: self.growth_global_x64,
    }
  }
}
