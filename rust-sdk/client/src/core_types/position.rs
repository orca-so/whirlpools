use orca_whirlpools_core::{PositionFacade, PositionRewardInfoFacade};

use crate::{accounts::Position, generated::types::PositionRewardInfo};

impl Into<PositionFacade> for Position {
    fn into(self) -> PositionFacade {
      PositionFacade {
        liquidity: self.liquidity,
        tick_lower_index: self.tick_lower_index,
        tick_upper_index: self.tick_upper_index,
        fee_growth_checkpoint_a: self.fee_growth_checkpoint_a,
        fee_growth_checkpoint_b: self.fee_growth_checkpoint_b,
        fee_owed_a: self.fee_owed_a,
        fee_owed_b: self.fee_owed_b,
        reward_infos: self.reward_infos.map(|info| info.into()),
      }
    }
}

impl Into<PositionRewardInfoFacade> for PositionRewardInfo {
    fn into(self) -> PositionRewardInfoFacade {
      PositionRewardInfoFacade {
        growth_inside_checkpoint: self.growth_inside_checkpoint,
        amount_owed: self.amount_owed,
      }
    }
}
