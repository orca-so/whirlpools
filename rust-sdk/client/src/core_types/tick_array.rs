use orca_whirlpools_core::{TickArrayFacade, TickFacade};

use crate::{accounts::TickArray, generated::types::Tick};

impl Into<TickArrayFacade> for TickArray {
    fn into(self) -> TickArrayFacade {
      TickArrayFacade {
        start_tick_index: self.start_tick_index,
        ticks: self.ticks.map(|tick| tick.into()),
      }
    }
}

impl Into<TickFacade> for Tick {
    fn into(self) -> TickFacade {
      TickFacade {
        liquidity_net: self.liquidity_net,
        initialized: self.initialized,
        fee_growth_outside_a: self.fee_growth_outside_a,
        fee_growth_outside_b: self.fee_growth_outside_b,
        reward_growths_outside: self.reward_growths_outside,
      }
    }
}
