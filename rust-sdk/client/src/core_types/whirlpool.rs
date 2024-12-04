use orca_whirlpools_core::{WhirlpoolFacade, WhirlpoolRewardInfoFacade};

use crate::{Whirlpool, WhirlpoolRewardInfo};

impl From<Whirlpool> for WhirlpoolFacade {
    fn from(val: Whirlpool) -> Self {
        WhirlpoolFacade {
            tick_spacing: val.tick_spacing,
            fee_rate: val.fee_rate,
            protocol_fee_rate: val.protocol_fee_rate,
            liquidity: val.liquidity,
            sqrt_price: val.sqrt_price,
            tick_current_index: val.tick_current_index,
            fee_growth_global_a: val.fee_growth_global_a,
            fee_growth_global_b: val.fee_growth_global_b,
            reward_last_updated_timestamp: val.reward_last_updated_timestamp,
            reward_infos: val.reward_infos.map(|info| info.into()),
        }
    }
}

impl From<WhirlpoolRewardInfo> for WhirlpoolRewardInfoFacade {
    fn from(val: WhirlpoolRewardInfo) -> Self {
        WhirlpoolRewardInfoFacade {
            emissions_per_second_x64: val.emissions_per_second_x64,
            growth_global_x64: val.growth_global_x64,
        }
    }
}
