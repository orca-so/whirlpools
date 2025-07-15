use anchor_lang::zero_copy;

use super::{NUM_REWARDS, TICK_ARRAY_SIZE};

// Max & min tick index based on sqrt(1.0001) & max.min price of 2^64
pub const MAX_TICK_INDEX: i32 = 443636;
pub const MIN_TICK_INDEX: i32 = -443636;

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug, PartialEq)]
pub struct Tick {
    // Total 113 bytes
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

impl From<TickUpdate> for Tick {
    fn from(update: TickUpdate) -> Self {
        Tick {
            initialized: update.initialized,
            liquidity_net: update.liquidity_net,
            liquidity_gross: update.liquidity_gross,
            fee_growth_outside_a: update.fee_growth_outside_a,
            fee_growth_outside_b: update.fee_growth_outside_b,
            reward_growths_outside: update.reward_growths_outside,
        }
    }
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
        !(MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_index)
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

    pub fn full_range_indexes(tick_spacing: u16) -> (i32, i32) {
        let lower_index = MIN_TICK_INDEX / tick_spacing as i32 * tick_spacing as i32;
        let upper_index = MAX_TICK_INDEX / tick_spacing as i32 * tick_spacing as i32;
        (lower_index, upper_index)
    }

    /// Bound a tick-index value to the max & min index value for this protocol
    ///
    /// # Parameters
    /// - `tick_index` - A i32 integer representing the tick index
    ///
    /// # Returns
    /// - `i32` The input tick index value but bounded by the max/min value of this protocol.
    pub fn bound_tick_index(tick_index: i32) -> i32 {
        tick_index.clamp(MIN_TICK_INDEX, MAX_TICK_INDEX)
    }
}

#[derive(Default, Clone, Debug, PartialEq)]
pub struct TickUpdate {
    pub initialized: bool,
    pub liquidity_net: i128,
    pub liquidity_gross: u128,
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    pub reward_growths_outside: [u128; NUM_REWARDS],
}

impl From<Tick> for TickUpdate {
    fn from(tick: Tick) -> Self {
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
mod check_is_valid_start_tick_tests {
    use super::*;
    const TS_8: u16 = 8;
    const TS_128: u16 = 128;

    #[test]
    fn test_start_tick_is_zero() {
        assert!(Tick::check_is_valid_start_tick(0, TS_8));
    }

    #[test]
    fn test_start_tick_is_valid_ts8() {
        assert!(Tick::check_is_valid_start_tick(704, TS_8));
    }

    #[test]
    fn test_start_tick_is_valid_ts128() {
        assert!(Tick::check_is_valid_start_tick(337920, TS_128));
    }

    #[test]
    fn test_start_tick_is_valid_negative_ts8() {
        assert!(Tick::check_is_valid_start_tick(-704, TS_8));
    }

    #[test]
    fn test_start_tick_is_valid_negative_ts128() {
        assert!(Tick::check_is_valid_start_tick(-337920, TS_128));
    }

    #[test]
    fn test_start_tick_is_not_valid_ts8() {
        assert!(!Tick::check_is_valid_start_tick(2353573, TS_8));
    }

    #[test]
    fn test_start_tick_is_not_valid_ts128() {
        assert!(!Tick::check_is_valid_start_tick(-2353573, TS_128));
    }

    #[test]
    fn test_min_tick_array_start_tick_is_valid_ts8() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_8 as i32) - 1;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_8 as i32;
        assert!(Tick::check_is_valid_start_tick(
            expected_start_index_for_last_array,
            TS_8
        ))
    }

    #[test]
    fn test_min_tick_array_sub_1_start_tick_is_invalid_ts8() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_8 as i32) - 2;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_8 as i32;
        assert!(!Tick::check_is_valid_start_tick(
            expected_start_index_for_last_array,
            TS_8
        ))
    }

    #[test]
    fn test_min_tick_array_start_tick_is_valid_ts128() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_128 as i32) - 1;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_128 as i32;
        assert!(Tick::check_is_valid_start_tick(
            expected_start_index_for_last_array,
            TS_128
        ))
    }

    #[test]
    fn test_min_tick_array_sub_1_start_tick_is_invalid_ts128() {
        let expected_array_index: i32 = (MIN_TICK_INDEX / TICK_ARRAY_SIZE / TS_128 as i32) - 2;
        let expected_start_index_for_last_array: i32 =
            expected_array_index * TICK_ARRAY_SIZE * TS_128 as i32;
        assert!(!Tick::check_is_valid_start_tick(
            expected_start_index_for_last_array,
            TS_128
        ))
    }
}

#[cfg(test)]
mod check_is_out_of_bounds_tests {
    use super::*;

    #[test]
    fn test_min_tick_index() {
        assert!(!Tick::check_is_out_of_bounds(MIN_TICK_INDEX));
    }

    #[test]
    fn test_max_tick_index() {
        assert!(!Tick::check_is_out_of_bounds(MAX_TICK_INDEX));
    }

    #[test]
    fn test_min_tick_index_sub_1() {
        assert!(Tick::check_is_out_of_bounds(MIN_TICK_INDEX - 1));
    }

    #[test]
    fn test_max_tick_index_add_1() {
        assert!(Tick::check_is_out_of_bounds(MAX_TICK_INDEX + 1));
    }
}

#[cfg(test)]
mod full_range_indexes_tests {
    use crate::math::FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD;

    use super::*;

    #[test]
    fn test_min_tick_spacing() {
        assert_eq!(
            Tick::full_range_indexes(1),
            (MIN_TICK_INDEX, MAX_TICK_INDEX)
        );
    }

    #[test]
    fn test_standard_tick_spacing() {
        assert_eq!(Tick::full_range_indexes(128), (-443520, 443520));
    }

    #[test]
    fn test_full_range_only_tick_spacing() {
        assert_eq!(
            Tick::full_range_indexes(FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD),
            (-425984, 425984)
        );
    }

    #[test]
    fn test_max_tick_spacing() {
        assert_eq!(Tick::full_range_indexes(u16::MAX), (-393210, 393210));
    }
}
