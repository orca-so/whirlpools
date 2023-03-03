use crate::errors::ErrorCode;
use crate::state::NUM_REWARDS;
use anchor_lang::prelude::*;

use super::Whirlpool;

// Max & min tick index based on sqrt(1.0001) & max.min price of 2^64
pub const MAX_TICK_INDEX: i32 = 443636;
pub const MIN_TICK_INDEX: i32 = -443636;

// We have two consts because most of our code uses it as a i32. However,
// for us to use it in tick array declarations, anchor requires it to be a usize.
pub const TICK_ARRAY_SIZE: i32 = 88;
pub const TICK_ARRAY_SIZE_USIZE: usize = 88;

#[zero_copy]
#[repr(packed)]
#[derive(Default, Debug, PartialEq)]
pub struct Tick {
    // Total 137 bytes
    pub initialized: bool,     // 1
    pub liquidity_net: i128,   // 16
    pub liquidity_gross: u128, // 16

    // Q64.64
    pub fee_growth_outside_a: u128, // 16
    // Q64.64
    pub fee_growth_outside_b: u128, // 16

    // Array of Q64.64
    pub reward_growths_outside: [u128; NUM_REWARDS], // 48 = 16 * 3
}

impl Tick {
    pub const LEN: usize = 113;

    /// Apply an update for this tick
    ///
    /// # Parameters
    /// - `update` - An update object to update the values in this tick
    pub fn update(&mut self, update: &TickUpdate) {
        self.initialized = update.initialized;
        self.liquidity_net = update.liquidity_net;
        self.liquidity_gross = update.liquidity_gross;
        self.fee_growth_outside_a = update.fee_growth_outside_a;
        self.fee_growth_outside_b = update.fee_growth_outside_b;
        self.reward_growths_outside = update.reward_growths_outside;
    }

    /// Check that the tick index is within the supported range of this contract
    ///
    /// # Parameters
    /// - `tick_index` - A i32 integer representing the tick index
    ///
    /// # Returns
    /// - `true`: The tick index is not within the range supported by this contract
    /// - `false`: The tick index is within the range supported by this contract
    pub fn check_is_out_of_bounds(tick_index: i32) -> bool {
        tick_index > MAX_TICK_INDEX || tick_index < MIN_TICK_INDEX
    }

    /// Check that the tick index is a valid start tick for a tick array in this whirlpool
    /// A valid start-tick-index is a multiple of tick_spacing & number of ticks in a tick-array.
    ///
    /// # Parameters
    /// - `tick_index` - A i32 integer representing the tick index
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    ///
    /// # Returns
    /// - `true`: The tick index is a valid start-tick-index for this whirlpool
    /// - `false`: The tick index is not a valid start-tick-index for this whirlpool
    ///            or the tick index not within the range supported by this contract
    pub fn check_is_valid_start_tick(tick_index: i32, tick_spacing: u16) -> bool {
        let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing as i32;

        if Tick::check_is_out_of_bounds(tick_index) {
            // Left-edge tick-array can have a start-tick-index smaller than the min tick index
            if tick_index > MIN_TICK_INDEX {
                return false;
            }

            let min_array_start_index =
                MIN_TICK_INDEX - (MIN_TICK_INDEX % ticks_in_array + ticks_in_array);
            return tick_index == min_array_start_index;
        }
        tick_index % ticks_in_array == 0
    }

    /// Check that the tick index is within bounds and is a usable tick index for the given tick spacing.
    ///
    /// # Parameters
    /// - `tick_index` - A i32 integer representing the tick index
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    ///
    /// # Returns
    /// - `true`: The tick index is within max/min index bounds for this protocol and is a usable tick-index given the tick-spacing
    /// - `false`: The tick index is out of bounds or is not a usable tick for this tick-spacing
    pub fn check_is_usable_tick(tick_index: i32, tick_spacing: u16) -> bool {
        if Tick::check_is_out_of_bounds(tick_index) {
            return false;
        }

        tick_index % tick_spacing as i32 == 0
    }

    /// Bound a tick-index value to the max & min index value for this protocol
    ///
    /// # Parameters
    /// - `tick_index` - A i32 integer representing the tick index
    ///
    /// # Returns
    /// - `i32` The input tick index value but bounded by the max/min value of this protocol.
    pub fn bound_tick_index(tick_index: i32) -> i32 {
        tick_index.max(MIN_TICK_INDEX).min(MAX_TICK_INDEX)
    }
}

#[derive(Default, Debug, PartialEq)]
pub struct TickUpdate {
    pub initialized: bool,
    pub liquidity_net: i128,
    pub liquidity_gross: u128,
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    pub reward_growths_outside: [u128; NUM_REWARDS],
}

impl TickUpdate {
    pub fn from(tick: &Tick) -> TickUpdate {
        TickUpdate {
            initialized: tick.initialized,
            liquidity_net: tick.liquidity_net,
            liquidity_gross: tick.liquidity_gross,
            fee_growth_outside_a: tick.fee_growth_outside_a,
            fee_growth_outside_b: tick.fee_growth_outside_b,
            reward_growths_outside: tick.reward_growths_outside,
        }
    }
}

#[account(zero_copy)]
#[repr(packed)]
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
    pub fn get_next_init_tick_index(
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

        while curr_offset >= 0 && curr_offset < TICK_ARRAY_SIZE {
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

    /// Get the Tick object at the given tick-index & tick-spacing
    ///
    /// # Parameters
    /// - `tick_index` - the tick index the desired Tick object is stored in
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    ///
    /// # Returns
    /// - `&Tick`: A reference to the desired Tick object
    /// - `TickNotFound`: - The provided tick-index is not an initializable tick index in this Whirlpool w/ this tick-spacing.
    pub fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<&Tick> {
        if !self.check_in_array_bounds(tick_index, tick_spacing)
            || !Tick::check_is_usable_tick(tick_index, tick_spacing)
        {
            return Err(ErrorCode::TickNotFound.into());
        }
        let offset = self.tick_offset(tick_index, tick_spacing)?;
        if offset < 0 {
            return Err(ErrorCode::TickNotFound.into());
        }
        Ok(&self.ticks[offset as usize])
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
    pub fn update_tick(
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

    /// Checks that this array holds the next tick index for the current tick index, given the pool's tick spacing & search direction.
    ///
    /// unshifted checks on [start, start + TICK_ARRAY_SIZE * tick_spacing)
    /// shifted checks on [start - tick_spacing, start + (TICK_ARRAY_SIZE - 1) * tick_spacing) (adjusting range by -tick_spacing)
    ///
    /// shifted == !a_to_b
    ///
    /// For a_to_b swaps, price moves left. All searchable ticks in this tick-array's range will end up in this tick's usable ticks.
    /// The search range is therefore the range of the tick-array.
    ///
    /// For b_to_a swaps, this tick-array's left-most ticks can be the 'next' usable tick-index of the previous tick-array.
    /// The right-most ticks also points towards the next tick-array. The search range is therefore shifted by 1 tick-spacing.
    pub fn in_search_range(&self, tick_index: i32, tick_spacing: u16, shifted: bool) -> bool {
        let mut lower = self.start_tick_index;
        let mut upper = self.start_tick_index + TICK_ARRAY_SIZE * tick_spacing as i32;
        if shifted {
            lower = lower - tick_spacing as i32;
            upper = upper - tick_spacing as i32;
        }
        tick_index >= lower && tick_index < upper
    }

    pub fn check_in_array_bounds(&self, tick_index: i32, tick_spacing: u16) -> bool {
        self.in_search_range(tick_index, tick_spacing, false)
    }

    pub fn is_min_tick_array(&self) -> bool {
        self.start_tick_index <= MIN_TICK_INDEX
    }

    pub fn is_max_tick_array(&self, tick_spacing: u16) -> bool {
        self.start_tick_index + TICK_ARRAY_SIZE * (tick_spacing as i32) > MAX_TICK_INDEX
    }

    // Calculates an offset from a tick index that can be used to access the tick data
    pub fn tick_offset(&self, tick_index: i32, tick_spacing: u16) -> Result<isize> {
        if tick_spacing == 0 {
            return Err(ErrorCode::InvalidTickSpacing.into());
        }

        Ok(get_offset(tick_index, self.start_tick_index, tick_spacing))
    }
}

fn get_offset(tick_index: i32, start_tick_index: i32, tick_spacing: u16) -> isize {
    // TODO: replace with i32.div_floor once not experimental
    let lhs = tick_index - start_tick_index;
    let rhs = tick_spacing as i32;
    let d = lhs / rhs;
    let r = lhs % rhs;
    let o = if (r > 0 && rhs < 0) || (r < 0 && rhs > 0) {
        d - 1
    } else {
        d
    };
    return o as isize;
}

#[cfg(test)]
pub mod tick_builder {
    use super::Tick;
    use crate::state::NUM_REWARDS;

    #[derive(Default)]
    pub struct TickBuilder {
        initialized: bool,
        liquidity_net: i128,
        liquidity_gross: u128,
        fee_growth_outside_a: u128,
        fee_growth_outside_b: u128,
        reward_growths_outside: [u128; NUM_REWARDS],
    }

    impl TickBuilder {
        pub fn initialized(mut self, initialized: bool) -> Self {
            self.initialized = initialized;
            self
        }

        pub fn liquidity_net(mut self, liquidity_net: i128) -> Self {
            self.liquidity_net = liquidity_net;
            self
        }

        pub fn liquidity_gross(mut self, liquidity_gross: u128) -> Self {
            self.liquidity_gross = liquidity_gross;
            self
        }

        pub fn fee_growth_outside_a(mut self, fee_growth_outside_a: u128) -> Self {
            self.fee_growth_outside_a = fee_growth_outside_a;
            self
        }

        pub fn fee_growth_outside_b(mut self, fee_growth_outside_b: u128) -> Self {
            self.fee_growth_outside_b = fee_growth_outside_b;
            self
        }

        pub fn reward_growths_outside(
            mut self,
            reward_growths_outside: [u128; NUM_REWARDS],
        ) -> Self {
            self.reward_growths_outside = reward_growths_outside;
            self
        }

        pub fn build(self) -> Tick {
            Tick {
                initialized: self.initialized,
                liquidity_net: self.liquidity_net,
                liquidity_gross: self.liquidity_gross,
                fee_growth_outside_a: self.fee_growth_outside_a,
                fee_growth_outside_b: self.fee_growth_outside_b,
                reward_growths_outside: self.reward_growths_outside,
            }
        }
    }
}

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_get_search_and_offset(
            tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            start_tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            tick_spacing in 1u16..u16::MAX,
            a_to_b in proptest::bool::ANY,
        ) {
            let mut array = TickArray::default();
            array.start_tick_index = start_tick_index;

            let in_search = array.in_search_range(tick_index, tick_spacing, !a_to_b);

            let mut lower_bound = start_tick_index;
            let mut upper_bound = start_tick_index + TICK_ARRAY_SIZE * tick_spacing as i32;
            let mut offset_lower = 0;
            let mut offset_upper = TICK_ARRAY_SIZE as isize;

            // If we are doing b_to_a, we shift the index bounds by -tick_spacing
            // and the offset bounds by -1
            if !a_to_b {
                lower_bound = lower_bound - tick_spacing as i32;
                upper_bound = upper_bound - tick_spacing as i32;
                offset_lower = -1;
                offset_upper = offset_upper - 1;
            }

            // in_bounds should be identical to search
            let in_bounds = tick_index >= lower_bound && tick_index < upper_bound;
            assert!(in_bounds == in_search);

            if in_search {
                let offset = get_offset(tick_index, start_tick_index, tick_spacing);
                assert!(offset >= offset_lower && offset < offset_upper)
            }
        }

        #[test]
        fn test_get_offset(
            tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            start_tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            tick_spacing in 1u16..u16::MAX,
        ) {
            let offset = get_offset(tick_index, start_tick_index, tick_spacing);
            let rounded = start_tick_index >= tick_index;
            let raw = (tick_index - start_tick_index) / tick_spacing as i32;
            let d = raw as isize;
            if !rounded {
                assert_eq!(offset, d);
            } else {
                assert!(offset == d || offset == (raw - 1) as isize);
            }
        }
    }
}

#[cfg(test)]
mod check_is_valid_start_tick_tests {
    use super::*;
    const TS_8: u16 = 8;
    const TS_128: u16 = 128;

    #[test]
    fn test_start_tick_is_zero() {
        assert_eq!(Tick::check_is_valid_start_tick(0, TS_8), true);
    }

    #[test]
    fn test_start_tick_is_valid_ts8() {
        assert_eq!(Tick::check_is_valid_start_tick(704, TS_8), true);
    }

    #[test]
    fn test_start_tick_is_valid_ts128() {
        assert_eq!(Tick::check_is_valid_start_tick(337920, TS_128), true);
    }

    #[test]
    fn test_start_tick_is_valid_negative_ts8() {
        assert_eq!(Tick::check_is_valid_start_tick(-704, TS_8), true);
    }

    #[test]
    fn test_start_tick_is_valid_negative_ts128() {
        assert_eq!(Tick::check_is_valid_start_tick(-337920, TS_128), true);
    }

    #[test]
    fn test_start_tick_is_not_valid_ts8() {
        assert_eq!(Tick::check_is_valid_start_tick(2353573, TS_8), false);
    }

    #[test]
    fn test_start_tick_is_not_valid_ts128() {
        assert_eq!(Tick::check_is_valid_start_tick(-2353573, TS_128), false);
    }

    #[test]
    fn test_min_tick_array_start_tick_is_valid_ts8() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_8 as i32) - 1;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_8 as i32;
        assert_eq!(
            Tick::check_is_valid_start_tick(expected_start_index_for_last_array, TS_8),
            true
        )
    }

    #[test]
    fn test_min_tick_array_sub_1_start_tick_is_invalid_ts8() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_8 as i32) - 2;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_8 as i32;
        assert_eq!(
            Tick::check_is_valid_start_tick(expected_start_index_for_last_array, TS_8),
            false
        )
    }

    #[test]
    fn test_min_tick_array_start_tick_is_valid_ts128() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_128 as i32) - 1;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_128 as i32;
        assert_eq!(
            Tick::check_is_valid_start_tick(expected_start_index_for_last_array, TS_128),
            true
        )
    }

    #[test]
    fn test_min_tick_array_sub_1_start_tick_is_invalid_ts128() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_128 as i32) - 2;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_128 as i32;
        assert_eq!(
            Tick::check_is_valid_start_tick(expected_start_index_for_last_array, TS_128),
            false
        )
    }
}

#[cfg(test)]
mod check_is_out_of_bounds_tests {
    use super::*;

    #[test]
    fn test_min_tick_index() {
        assert_eq!(Tick::check_is_out_of_bounds(MIN_TICK_INDEX), false);
    }

    #[test]
    fn test_max_tick_index() {
        assert_eq!(Tick::check_is_out_of_bounds(MAX_TICK_INDEX), false);
    }

    #[test]
    fn test_min_tick_index_sub_1() {
        assert_eq!(Tick::check_is_out_of_bounds(MIN_TICK_INDEX - 1), true);
    }

    #[test]
    fn test_max_tick_index_add_1() {
        assert_eq!(Tick::check_is_out_of_bounds(MAX_TICK_INDEX + 1), true);
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

        let expected = Tick {
            initialized: true,
            liquidity_net: 24128472184712i128,
            liquidity_gross: 353873892732u128,
            fee_growth_outside_a: 3928372892u128,
            fee_growth_outside_b: 12242u128,
            reward_growths_outside: [53264u128, 539282u128, 98744u128],
        };
        let result = array.get_tick(tick_index, tick_spacing).unwrap();
        assert_eq!(*result, expected);
    }
}
