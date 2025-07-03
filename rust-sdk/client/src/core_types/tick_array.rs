use orca_whirlpools_core::TickArrayFacade;

use crate::TickArray;

impl From<TickArray> for TickArrayFacade {
    fn from(val: TickArray) -> Self {
        match val {
            TickArray::FixedTickArray(fixed_tick_array) => fixed_tick_array.into(),
            TickArray::DynamicTickArray(dynamic_tick_array) => dynamic_tick_array.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DynamicTick, DynamicTickArray, DynamicTickData, FixedTickArray, Tick,
        DYNAMIC_TICK_ARRAY_DISCRIMINATOR, FIXED_TICK_ARRAY_DISCRIMINATOR,
    };
    use solana_program::pubkey::Pubkey;

    #[test]
    fn test_fixed_tick_array_to_facade() {
        let mut ticks: [Tick; 88] = std::array::from_fn(|_| Tick {
            initialized: false,
            liquidity_net: 0,
            liquidity_gross: 0,
            fee_growth_outside_a: 0,
            fee_growth_outside_b: 0,
            reward_growths_outside: [0, 0, 0],
        });

        ticks[1] = Tick {
            initialized: true,
            liquidity_net: 100,
            liquidity_gross: 200,
            fee_growth_outside_a: 300,
            fee_growth_outside_b: 400,
            reward_growths_outside: [500, 600, 700],
        };

        let fixed_tick_array = FixedTickArray {
            discriminator: FIXED_TICK_ARRAY_DISCRIMINATOR.try_into().unwrap(),
            start_tick_index: 88,
            whirlpool: Pubkey::new_unique(),
            ticks,
        };

        let tick_array = TickArray::FixedTickArray(fixed_tick_array.clone());

        let facade: TickArrayFacade = tick_array.into();

        assert_eq!(facade.start_tick_index, 88);
        assert_eq!(facade.ticks[1].initialized, true);
        assert_eq!(facade.ticks[1].liquidity_net, 100);
        assert_eq!(facade.ticks[1].liquidity_gross, 200);
    }

    #[test]
    fn test_dynamic_tick_array_to_facade() {
        let mut ticks: [DynamicTick; 88] = std::array::from_fn(|_| DynamicTick::Uninitialized);

        ticks[2] = DynamicTick::Initialized(DynamicTickData {
            liquidity_net: 150,
            liquidity_gross: 250,
            fee_growth_outside_a: 350,
            fee_growth_outside_b: 450,
            reward_growths_outside: [550, 650, 750],
        });

        let dynamic_tick_array = DynamicTickArray {
            discriminator: DYNAMIC_TICK_ARRAY_DISCRIMINATOR.try_into().unwrap(),
            start_tick_index: 176,
            whirlpool: Pubkey::new_unique(),
            tick_bitmap: 1 << 2,
            ticks,
        };

        let tick_array = TickArray::DynamicTickArray(dynamic_tick_array.clone());

        let facade: TickArrayFacade = tick_array.into();

        assert_eq!(facade.start_tick_index, 176);
        assert_eq!(facade.ticks[2].initialized, true);
        assert_eq!(facade.ticks[2].liquidity_net, 150);
        assert_eq!(facade.ticks[2].liquidity_gross, 250);
    }
}
