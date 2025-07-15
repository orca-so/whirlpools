#![allow(deprecated)]
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

use super::{Tick, TickArrayType, TickUpdate, Whirlpool, TICK_ARRAY_SIZE, TICK_ARRAY_SIZE_USIZE};

// The actual type should still be called TickArray so that it derives
// the correct discriminator. This same rename is done in the SDKs to make the distinction clear between
// * TickArray: A variable- or fixed-length tick array
// * FixedTickArray: A fixed-length tick array
// * DynamicTickArray: A variable-length tick array
pub type FixedTickArray = TickArray;

#[deprecated(note = "Use FixedTickArray instead")]
#[account(zero_copy(unsafe))]
#[repr(C, packed)]
pub struct TickArray {
    pub start_tick_index: i32,
    pub ticks: [Tick; TICK_ARRAY_SIZE_USIZE],
    pub whirlpool: Pubkey,
}

impl Default for TickArray {
    #[inline]
    fn default() -> TickArray {
        TickArray {
            whirlpool: Pubkey::default(),
            ticks: [Tick::default(); TICK_ARRAY_SIZE_USIZE],
            start_tick_index: 0,
        }
    }
}

impl TickArray {
    pub const LEN: usize = 8 + 36 + (Tick::LEN * TICK_ARRAY_SIZE_USIZE);

    /// Initialize the TickArray object
    ///
    /// # Parameters
    /// - `whirlpool` - the tick index the desired Tick object is stored in
    /// - `start_tick_index` - A u8 integer of the tick spacing for this whirlpool
    ///
    /// # Errors
    /// - `InvalidStartTick`: - The provided start-tick-index is not an initializable tick index in this Whirlpool w/ this tick-spacing.
    pub fn initialize(
        &mut self,
        whirlpool: &Account<Whirlpool>,
        start_tick_index: i32,
    ) -> Result<()> {
        if !Tick::check_is_valid_start_tick(start_tick_index, whirlpool.tick_spacing) {
            return Err(ErrorCode::InvalidStartTick.into());
        }

        self.whirlpool = whirlpool.key();
        self.start_tick_index = start_tick_index;
        Ok(())
    }
}

impl TickArrayType for TickArray {
    fn is_variable_size(&self) -> bool {
        false
    }

    fn start_tick_index(&self) -> i32 {
        self.start_tick_index
    }

    fn whirlpool(&self) -> Pubkey {
        self.whirlpool
    }

    /// Search for the next initialized tick in this array.
    ///
    /// # Parameters
    /// - `tick_index` - A i32 integer representing the tick index to start searching for
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    /// - `a_to_b` - If the trade is from a_to_b, the search will move to the left and the starting search tick is inclusive.
    ///              If the trade is from b_to_a, the search will move to the right and the starting search tick is not inclusive.
    ///
    /// # Returns
    /// - `Some(i32)`: The next initialized tick index of this array
    /// - `None`: An initialized tick index was not found in this array
    /// - `InvalidTickArraySequence` - error if `tick_index` is not a valid search tick for the array
    /// - `InvalidTickSpacing` - error if the provided tick spacing is 0
    fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>> {
        if !self.in_search_range(tick_index, tick_spacing, !a_to_b) {
            return Err(ErrorCode::InvalidTickArraySequence.into());
        }

        let mut curr_offset = match self.tick_offset(tick_index, tick_spacing) {
            Ok(value) => value as i32,
            Err(e) => return Err(e),
        };

        // For a_to_b searches, the search moves to the left. The next possible init-tick can be the 1st tick in the current offset
        // For b_to_a searches, the search moves to the right. The next possible init-tick cannot be within the current offset
        if !a_to_b {
            curr_offset += 1;
        }

        while (0..TICK_ARRAY_SIZE).contains(&curr_offset) {
            let curr_tick = self.ticks[curr_offset as usize];
            if curr_tick.initialized {
                return Ok(Some(
                    (curr_offset * tick_spacing as i32) + self.start_tick_index,
                ));
            }

            curr_offset = if a_to_b {
                curr_offset - 1
            } else {
                curr_offset + 1
            };
        }

        Ok(None)
    }

    /// Get the Tick object at the given tick-index & tick-spacing
    ///
    /// # Parameters
    /// - `tick_index` - the tick index the desired Tick object is stored in
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    ///
    /// # Returns
    /// - `&Tick`: A reference to the desired Tick object
    /// - `TickNotFound`: - The provided tick-index is not an initializable tick index in this Whirlpool w/ this tick-spacing.
    fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<Tick> {
        if !self.check_in_array_bounds(tick_index, tick_spacing)
            || !Tick::check_is_usable_tick(tick_index, tick_spacing)
        {
            return Err(ErrorCode::TickNotFound.into());
        }
        let offset = self.tick_offset(tick_index, tick_spacing)?;
        if offset < 0 {
            return Err(ErrorCode::TickNotFound.into());
        }
        Ok(self.ticks[offset as usize])
    }

    /// Updates the Tick object at the given tick-index & tick-spacing
    ///
    /// # Parameters
    /// - `tick_index` - the tick index the desired Tick object is stored in
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    /// - `update` - A reference to a TickUpdate object to update the Tick object at the given index
    ///
    /// # Errors
    /// - `TickNotFound`: - The provided tick-index is not an initializable tick index in this Whirlpool w/ this tick-spacing.
    fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()> {
        if !self.check_in_array_bounds(tick_index, tick_spacing)
            || !Tick::check_is_usable_tick(tick_index, tick_spacing)
        {
            return Err(ErrorCode::TickNotFound.into());
        }
        let offset = self.tick_offset(tick_index, tick_spacing)?;
        if offset < 0 {
            return Err(ErrorCode::TickNotFound.into());
        }
        self.ticks.get_mut(offset as usize).unwrap().update(update);
        Ok(())
    }
}

#[cfg(test)]
pub mod tick_array_builder {
    use super::*;

    #[derive(Default)]
    pub struct TickArrayBuilder(TickArray);

    impl TickArrayBuilder {
        pub fn start_tick_index(mut self, start_tick_index: i32) -> Self {
            self.0.start_tick_index = start_tick_index;
            self
        }

        pub fn whirlpool(mut self, whirlpool: Pubkey) -> Self {
            self.0.whirlpool = whirlpool;
            self
        }

        pub fn tick(mut self, tick: Tick, tick_index: i32, tick_spacing: u16) -> Self {
            let offset = self.0.tick_offset(tick_index, tick_spacing).unwrap();
            assert!(offset >= 0);
            self.0.ticks[offset as usize] = tick;
            self
        }

        pub fn tick_with_offset(mut self, tick: Tick, offset: usize) -> Self {
            self.0.ticks[offset] = tick;
            self
        }

        pub fn ticks(mut self, ticks: [Tick; TICK_ARRAY_SIZE_USIZE]) -> Self {
            self.0.ticks = ticks;
            self
        }

        pub fn build(self) -> TickArray {
            self.0
        }
    }
}

#[cfg(test)]
mod array_update_tests {
    use super::*;

    #[test]
    fn update_applies_successfully() {
        let mut array = TickArray::default();
        let tick_index = 8;
        let original = Tick {
            initialized: true,
            liquidity_net: 2525252i128,
            liquidity_gross: 2525252u128,
            fee_growth_outside_a: 28728282u128,
            fee_growth_outside_b: 22528728282u128,
            reward_growths_outside: [124272242u128, 1271221u128, 966958u128],
        };

        array.ticks[1] = original;

        let update = TickUpdate {
            initialized: true,
            liquidity_net: 24128472184712i128,
            liquidity_gross: 353873892732u128,
            fee_growth_outside_a: 3928372892u128,
            fee_growth_outside_b: 12242u128,
            reward_growths_outside: [53264u128, 539282u128, 98744u128],
        };

        let tick_spacing = 8;

        array
            .update_tick(tick_index, tick_spacing, &update)
            .unwrap();

        let result = array.get_tick(tick_index, tick_spacing).unwrap();
        assert_eq!(result, update.into());
    }
}

#[cfg(test)]
mod data_layout_tests {
    use crate::state::NUM_REWARDS;

    use super::*;

    #[test]
    fn test_tick_array_data_layout() {
        let tick_array_start_tick_index = 0x70e0d0c0i32;
        let tick_array_whirlpool = Pubkey::new_unique();

        let tick_initialized = true;
        let tick_liquidity_net = 0x11002233445566778899aabbccddeeffi128;
        let tick_liquidity_gross = 0xff00eeddccbbaa998877665544332211u128;
        let tick_fee_growth_outside_a = 0x11220033445566778899aabbccddeeffu128;
        let tick_fee_growth_outside_b = 0xffee00ddccbbaa998877665544332211u128;
        let tick_reward_growths_outside = [
            0x11223300445566778899aabbccddeeffu128,
            0x11223344005566778899aabbccddeeffu128,
            0x11223344550066778899aabbccddeeffu128,
        ];

        // manually build the expected Tick data layout
        let mut tick_data = [0u8; Tick::LEN];
        let mut offset = 0;
        tick_data[offset] = tick_initialized as u8;
        offset += 1;
        tick_data[offset..offset + 16].copy_from_slice(&tick_liquidity_net.to_le_bytes());
        offset += 16;
        tick_data[offset..offset + 16].copy_from_slice(&tick_liquidity_gross.to_le_bytes());
        offset += 16;
        tick_data[offset..offset + 16].copy_from_slice(&tick_fee_growth_outside_a.to_le_bytes());
        offset += 16;
        tick_data[offset..offset + 16].copy_from_slice(&tick_fee_growth_outside_b.to_le_bytes());
        offset += 16;
        for i in 0..NUM_REWARDS {
            tick_data[offset..offset + 16]
                .copy_from_slice(&tick_reward_growths_outside[i].to_le_bytes());
            offset += 16;
        }

        // manually build the expected TickArray data layout
        // note: no discriminator
        let mut tick_array_data = [0u8; TickArray::LEN - 8];
        let mut offset = 0;
        tick_array_data[offset..offset + 4]
            .copy_from_slice(&tick_array_start_tick_index.to_le_bytes());
        offset += 4;
        for _ in 0..TICK_ARRAY_SIZE_USIZE {
            tick_array_data[offset..offset + Tick::LEN].copy_from_slice(&tick_data);
            offset += Tick::LEN;
        }
        tick_array_data[offset..offset + 32].copy_from_slice(&tick_array_whirlpool.to_bytes());
        offset += 32;

        assert_eq!(offset, tick_array_data.len());
        assert_eq!(tick_array_data.len(), core::mem::size_of::<TickArray>());

        // cast from bytes to TickArray (re-interpret)
        let tick_array: &TickArray = bytemuck::from_bytes(&tick_array_data);

        // check that the data layout matches the expected layout
        let read_start_tick_index = tick_array.start_tick_index;
        assert_eq!(read_start_tick_index, tick_array_start_tick_index);
        for i in 0..TICK_ARRAY_SIZE_USIZE {
            let read_tick = tick_array.ticks[i];

            let read_initialized = read_tick.initialized;
            assert_eq!(read_initialized, tick_initialized);
            let read_liquidity_net = read_tick.liquidity_net;
            assert_eq!(read_liquidity_net, tick_liquidity_net);
            let read_liquidity_gross = read_tick.liquidity_gross;
            assert_eq!(read_liquidity_gross, tick_liquidity_gross);
            let read_fee_growth_outside_a = read_tick.fee_growth_outside_a;
            assert_eq!(read_fee_growth_outside_a, tick_fee_growth_outside_a);
            let read_fee_growth_outside_b = read_tick.fee_growth_outside_b;
            assert_eq!(read_fee_growth_outside_b, tick_fee_growth_outside_b);
            let read_reward_growths_outside = read_tick.reward_growths_outside;
            assert_eq!(read_reward_growths_outside, tick_reward_growths_outside);
        }
        let read_whirlpool = tick_array.whirlpool;
        assert_eq!(read_whirlpool, tick_array_whirlpool);
    }
}

#[cfg(test)]
mod next_init_tick_tests {
    use super::*;

    fn tick_update() -> TickUpdate {
        TickUpdate {
            initialized: true,
            ..TickUpdate::default()
        }
    }

    #[test]
    fn a_to_b_search_returns_next_init_tick() {
        let mut array = TickArray::default();
        let tick_spacing = 8;

        array.update_tick(8, tick_spacing, &tick_update()).unwrap();

        let result = array
            .get_next_init_tick_index(64, tick_spacing, true)
            .unwrap();
        assert_eq!(result, Some(8));
    }

    #[test]
    fn a_to_b_negative_tick() {
        let mut array = TickArray::default();
        array.start_tick_index = -704;
        let tick_spacing = 8;

        array
            .update_tick(-64, tick_spacing, &tick_update())
            .unwrap();

        let result = array
            .get_next_init_tick_index(-8, tick_spacing, true)
            .unwrap();
        assert_eq!(result, Some(-64));
    }

    #[test]
    fn a_to_b_search_returns_none_if_no_init_tick() {
        let array = TickArray::default();
        let tick_spacing = 8;

        let result = array
            .get_next_init_tick_index(64, tick_spacing, true)
            .unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn b_to_a_search_returns_next_init_tick() {
        let mut array = TickArray::default();
        let tick_spacing = 8;

        array.update_tick(64, tick_spacing, &tick_update()).unwrap();

        let result = array
            .get_next_init_tick_index(8, tick_spacing, false)
            .unwrap();
        assert_eq!(result, Some(64));
    }

    #[test]
    fn b_to_a_negative_tick() {
        let mut array = TickArray::default();
        array.start_tick_index = -704;
        let tick_spacing = 8;

        array.update_tick(-8, tick_spacing, &tick_update()).unwrap();

        let result = array
            .get_next_init_tick_index(-64, tick_spacing, false)
            .unwrap();
        assert_eq!(result, Some(-8));
    }

    #[test]
    fn b_to_a_search_returns_none_if_no_init_tick() {
        let array = TickArray::default();
        let tick_spacing = 8;

        let result = array
            .get_next_init_tick_index(8, tick_spacing, false)
            .unwrap();
        assert_eq!(result, None);
    }
}
