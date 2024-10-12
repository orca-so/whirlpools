use orca_whirlpools_core::{PositionFacade, PositionRewardInfoFacade};

use crate::{accounts::Position, generated::types::PositionRewardInfo};

impl From<Position> for PositionFacade {
    fn from(val: Position) -> Self {
        PositionFacade {
            liquidity: val.liquidity,
            tick_lower_index: val.tick_lower_index,
            tick_upper_index: val.tick_upper_index,
            fee_growth_checkpoint_a: val.fee_growth_checkpoint_a,
            fee_growth_checkpoint_b: val.fee_growth_checkpoint_b,
            fee_owed_a: val.fee_owed_a,
            fee_owed_b: val.fee_owed_b,
            reward_infos: val.reward_infos.map(|info| info.into()),
        }
    }
}

impl From<PositionRewardInfo> for PositionRewardInfoFacade {
    fn from(val: PositionRewardInfo) -> Self {
        PositionRewardInfoFacade {
            growth_inside_checkpoint: val.growth_inside_checkpoint,
            amount_owed: val.amount_owed,
        }
    }
}
