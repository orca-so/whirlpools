use orca_whirlpools_core::{TickArrayFacade, TickFacade};

use crate::{Tick, TickArray};

impl From<TickArray> for TickArrayFacade {
    fn from(val: TickArray) -> Self {
        TickArrayFacade {
            start_tick_index: val.start_tick_index,
            ticks: val.ticks.map(|tick| tick.into()),
        }
    }
}

impl From<Tick> for TickFacade {
    fn from(val: Tick) -> Self {
        TickFacade {
            liquidity_net: val.liquidity_net,
            liquidity_gross: val.liquidity_gross,
            initialized: val.initialized,
            fee_growth_outside_a: val.fee_growth_outside_a,
            fee_growth_outside_b: val.fee_growth_outside_b,
            reward_growths_outside: val.reward_growths_outside,
        }
    }
}
