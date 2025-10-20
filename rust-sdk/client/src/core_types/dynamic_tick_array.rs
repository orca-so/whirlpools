use orca_whirlpools_core::{TickArrayFacade, TickFacade};

use crate::{DynamicTick, DynamicTickArray};

impl From<DynamicTickArray> for TickArrayFacade {
    fn from(val: DynamicTickArray) -> Self {
        TickArrayFacade {
            start_tick_index: val.start_tick_index,
            ticks: val.ticks.map(|tick| tick.into()),
        }
    }
}

impl From<DynamicTick> for TickFacade {
    fn from(val: DynamicTick) -> Self {
        match val {
            DynamicTick::Uninitialized => TickFacade {
                initialized: false,
                liquidity_net: 0,
                liquidity_gross: 0,
                fee_growth_outside_a: 0,
                fee_growth_outside_b: 0,
                reward_growths_outside: [0, 0, 0],
            },
            DynamicTick::Initialized(tick) => TickFacade {
                initialized: true,
                liquidity_net: tick.liquidity_net,
                liquidity_gross: tick.liquidity_gross,
                fee_growth_outside_a: tick.fee_growth_outside_a,
                fee_growth_outside_b: tick.fee_growth_outside_b,
                reward_growths_outside: tick.reward_growths_outside,
            },
        }
    }
}
