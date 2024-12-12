use crate::errors::ErrorCode;
use crate::state::*;
use crate::util::ProxiedTickArray;
use anchor_lang::prelude::*;
use std::cell::RefMut;

pub struct SwapTickSequence<'info> {
    arrays: Vec<ProxiedTickArray<'info>>,
}

impl<'info> SwapTickSequence<'info> {
    pub fn new(
        ta0: RefMut<'info, TickArray>,
        ta1: Option<RefMut<'info, TickArray>>,
        ta2: Option<RefMut<'info, TickArray>>,
    ) -> Self {
        Self::new_with_proxy(
            ProxiedTickArray::new_initialized(ta0),
            ta1.map(ProxiedTickArray::new_initialized),
            ta2.map(ProxiedTickArray::new_initialized),
        )
    }

    pub(crate) fn new_with_proxy(
        ta0: ProxiedTickArray<'info>,
        ta1: Option<ProxiedTickArray<'info>>,
        ta2: Option<ProxiedTickArray<'info>>,
    ) -> Self {
        let mut vec = Vec::with_capacity(3);
        vec.push(ta0);
        if let Some(ta1) = ta1 {
            vec.push(ta1);
        }
        if let Some(ta2) = ta2 {
            vec.push(ta2);
        }
        Self { arrays: vec }
    }

    /// Get the Tick object at the given tick-index & tick-spacing
    ///
    /// # Parameters
    /// - `array_index` - the array index that the tick of this given tick-index would be stored in
    /// - `tick_index` - the tick index the desired Tick object is stored in
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    ///
    /// # Returns
    /// - `&Tick`: A reference to the desired Tick object
    /// - `TickArrayIndexOutofBounds` - The provided array-index is out of bounds
    /// - `TickNotFound`: - The provided tick-index is not an initializable tick index in this Whirlpool w/ this tick-spacing.
    pub fn get_tick(
        &self,
        array_index: usize,
        tick_index: i32,
        tick_spacing: u16,
    ) -> Result<&Tick> {
        let array = self.arrays.get(array_index);
        match array {
            Some(array) => array.get_tick(tick_index, tick_spacing),
            _ => Err(ErrorCode::TickArrayIndexOutofBounds.into()),
        }
    }

    /// Updates the Tick object at the given tick-index & tick-spacing
    ///
    /// # Parameters
    /// - `array_index` - the array index that the tick of this given tick-index would be stored in
    /// - `tick_index` - the tick index the desired Tick object is stored in
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    /// - `update` - A reference to a TickUpdate object to update the Tick object at the given index
    ///
    /// # Errors
    /// - `TickArrayIndexOutofBounds` - The provided array-index is out of bounds
    /// - `TickNotFound`: - The provided tick-index is not an initializable tick index in this Whirlpool w/ this tick-spacing.
    pub fn update_tick(
        &mut self,
        array_index: usize,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()> {
        let array = self.arrays.get_mut(array_index);
        match array {
            Some(array) => {
                array.update_tick(tick_index, tick_spacing, update)?;
                Ok(())
            }
            _ => Err(ErrorCode::TickArrayIndexOutofBounds.into()),
        }
    }

    pub fn get_tick_offset(
        &self,
        array_index: usize,
        tick_index: i32,
        tick_spacing: u16,
    ) -> Result<isize> {
        let array = self.arrays.get(array_index);
        match array {
            Some(array) => array.tick_offset(tick_index, tick_spacing),
            _ => Err(ErrorCode::TickArrayIndexOutofBounds.into()),
        }
    }

    /// Get the next initialized tick in the provided tick range
    ///
    /// # Parameters
    /// - `tick_index` - the tick index to start searching from
    /// - `tick_spacing` - A u8 integer of the tick spacing for this whirlpool
    /// - `a_to_b` - If the trade is from a_to_b, the search will move to the left and the starting search tick is inclusive.
    ///              If the trade is from b_to_a, the search will move to the right and the starting search tick is not inclusive.
    /// - `start_array_index` -
    ///
    /// # Returns
    /// - `(usize, i32, &mut Tick)`: The array_index which the next initialized index was found, the next initialized tick-index & a mutable reference to that tick
    /// - `TickArraySequenceInvalidIndex` - The swap loop provided an invalid array index to query the next tick in.
    /// - `InvalidTickArraySequence`: - User provided tick-arrays are not in sequential order required to proceed in this trade direction.

    pub fn get_next_initialized_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
        start_array_index: usize,
    ) -> Result<(usize, i32)> {
        let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing as i32;
        let mut search_index = tick_index;
        let mut array_index = start_array_index;

        // Keep looping the arrays until an initialized tick index in the subsequent tick-arrays found.
        loop {
            // If we get to the end of the array sequence and next_index is still not found, throw error
            let next_array = match self.arrays.get(array_index) {
                Some(array) => array,
                None => return Err(ErrorCode::TickArraySequenceInvalidIndex.into()),
            };

            let next_index =
                next_array.get_next_init_tick_index(search_index, tick_spacing, a_to_b)?;

            match next_index {
                Some(next_index) => {
                    return Ok((array_index, next_index));
                }
                None => {
                    // If we are at the last valid tick array, return the min/max tick index
                    if a_to_b && next_array.is_min_tick_array() {
                        return Ok((array_index, MIN_TICK_INDEX));
                    } else if !a_to_b && next_array.is_max_tick_array(tick_spacing) {
                        return Ok((array_index, MAX_TICK_INDEX));
                    }

                    // If we are at the last tick array in the sequencer, return the last tick
                    if array_index + 1 == self.arrays.len() {
                        if a_to_b {
                            return Ok((array_index, next_array.start_tick_index()));
                        } else {
                            let last_tick = next_array.start_tick_index() + ticks_in_array - 1;
                            return Ok((array_index, last_tick));
                        }
                    }

                    // No initialized index found. Move the search-index to the 1st search position
                    // of the next array in sequence.
                    search_index = if a_to_b {
                        next_array.start_tick_index() - 1
                    } else {
                        next_array.start_tick_index() + ticks_in_array - 1
                    };

                    array_index += 1;
                }
            }
        }
    }
}

#[cfg(test)]
mod swap_tick_sequence_tests {
    use super::*;
    use std::cell::RefCell;

    const TS_8: u16 = 8;
    const TS_128: u16 = 128;
    const LAST_TICK_OFFSET: usize = TICK_ARRAY_SIZE as usize - 1;

    fn build_tick_array(
        start_tick_index: i32,
        initialized_offsets: Vec<usize>,
    ) -> RefCell<TickArray> {
        let mut array = TickArray {
            start_tick_index,
            ..TickArray::default()
        };

        for offset in initialized_offsets {
            array.ticks[offset] = Tick {
                initialized: true,
                ..Tick::default()
            };
        }

        RefCell::new(array)
    }

    mod modify_ticks {
        use super::*;

        #[test]
        fn modify_tick_init_tick() {
            let ta0 = build_tick_array(11264, vec![50]);
            let ta1 = build_tick_array(0, vec![25, 71]);
            let ta2 = build_tick_array(-11264, vec![25, 35, 56]);
            let mut swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let initialized_ticks_offsets = [(0, 50), (1, 25), (1, 71), (2, 25), (2, 35), (2, 56)];

            for init_tick_offset in initialized_ticks_offsets {
                let array_index = init_tick_offset.0 as usize;
                let tick_index = 11264 - array_index as i32 * TS_128 as i32 * TICK_ARRAY_SIZE
                    + init_tick_offset.1 * TS_128 as i32;
                let result = swap_tick_sequence.get_tick(array_index, tick_index, TS_128);
                assert!(result.is_ok());
                assert!(result.unwrap().initialized);

                let update_result = swap_tick_sequence.update_tick(
                    array_index,
                    tick_index,
                    TS_128,
                    &TickUpdate {
                        initialized: false,
                        liquidity_net: 1500,
                        ..Default::default()
                    },
                );
                assert!(update_result.is_ok());

                let get_updated_result = swap_tick_sequence
                    .get_tick(array_index, tick_index, TS_128)
                    .unwrap();
                let liq_net = get_updated_result.liquidity_net;
                assert_eq!(liq_net, 1500);
            }
        }

        #[test]
        fn modify_tick_uninitializable_tick() {
            let ta0 = build_tick_array(9216, vec![50]);
            let ta1 = build_tick_array(0, vec![25, 71]);
            let ta2 = build_tick_array(-9216, vec![25, 35, 56]);
            let mut swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let uninitializable_tick_indices = [(0, 9217), (1, 257), (2, -5341)];

            for uninitializable_search_tick in uninitializable_tick_indices {
                let result = swap_tick_sequence.get_tick(
                    uninitializable_search_tick.0,
                    uninitializable_search_tick.1,
                    TS_128,
                );

                assert_eq!(result.unwrap_err(), ErrorCode::TickNotFound.into());

                let update_result = swap_tick_sequence.update_tick(
                    uninitializable_search_tick.0,
                    uninitializable_search_tick.1,
                    TS_128,
                    &TickUpdate {
                        initialized: false,
                        liquidity_net: 1500,
                        ..Default::default()
                    },
                );
                assert_eq!(update_result.unwrap_err(), ErrorCode::TickNotFound.into());
            }
        }

        #[test]
        fn modify_tick_uninitialized_tick() {
            let ta0 = build_tick_array(9216, vec![50]);
            let ta1 = build_tick_array(0, vec![25, 71]);
            let ta2 = build_tick_array(-9216, vec![25, 35, 56]);
            let mut swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let uninitialized_tick_indices = [(0, 13696), (1, 0), (1, 3072), (2, -3456)];

            for uninitializable_search_tick in uninitialized_tick_indices {
                let result = swap_tick_sequence.get_tick(
                    uninitializable_search_tick.0,
                    uninitializable_search_tick.1,
                    TS_128,
                );

                assert!(!result.unwrap().initialized);

                let update_result = swap_tick_sequence.update_tick(
                    uninitializable_search_tick.0,
                    uninitializable_search_tick.1,
                    TS_128,
                    &TickUpdate {
                        initialized: true,
                        liquidity_net: 1500,
                        ..Default::default()
                    },
                );
                assert!(update_result.is_ok());

                let get_updated_result = swap_tick_sequence
                    .get_tick(
                        uninitializable_search_tick.0,
                        uninitializable_search_tick.1,
                        TS_128,
                    )
                    .unwrap();
                assert!(get_updated_result.initialized);
                let liq_net = get_updated_result.liquidity_net;
                assert_eq!(liq_net, 1500);
            }
        }

        #[test]
        fn cannot_modify_invalid_array_index() {
            let ta0 = build_tick_array(9216, vec![50]);
            let ta1 = build_tick_array(0, vec![25, 71]);
            let ta2 = build_tick_array(-9216, vec![25, 35, 56]);
            let mut swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let get_result = swap_tick_sequence.get_tick(3, 5000, TS_128);
            assert_eq!(
                get_result.unwrap_err(),
                ErrorCode::TickArrayIndexOutofBounds.into()
            );

            let update_result = swap_tick_sequence.update_tick(
                3,
                5000,
                TS_128,
                &TickUpdate {
                    ..Default::default()
                },
            );
            assert_eq!(
                update_result.unwrap_err(),
                ErrorCode::TickArrayIndexOutofBounds.into()
            );
        }
    }

    mod a_to_b {
        use super::*;

        #[test]
        /// In an a_to_b search, the search-range of a tick-array is between 0 & last-tick - 1
        fn search_range() {
            let ta0 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let ta1 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let ta2 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            // Verify start range is ok at start-tick-index
            let (start_range_array_index, start_range_result_index) = swap_tick_sequence
                .get_next_initialized_tick_index(0, TS_128, true, 2)
                .unwrap();
            assert_eq!(start_range_result_index, 0);
            assert_eq!(start_range_array_index, 2);

            // Verify search is ok at the last tick-index in array
            let last_tick_in_array = (TICK_ARRAY_SIZE * TS_128 as i32) - 1;
            let expected_last_usable_tick_index = LAST_TICK_OFFSET as i32 * TS_128 as i32;
            let (end_range_array_index, end_range_result_index) = swap_tick_sequence
                .get_next_initialized_tick_index(last_tick_in_array, TS_128, true, 2)
                .unwrap();
            assert_eq!(end_range_result_index, expected_last_usable_tick_index);
            assert_eq!(end_range_array_index, 2);
        }

        #[test]
        /// On a b_to_a search where the search_index is within [-tickSpacing, 0) and search array begins at 0, correctly
        /// uses 0 as next initialized. This test is shifted by TICK_ARRAY_SIZE * TS_128.
        fn search_range_on_left() {
            let ta0 = build_tick_array(
                TICK_ARRAY_SIZE * TS_128 as i32,
                vec![0, 1, LAST_TICK_OFFSET],
            );
            let swap_tick_sequence = SwapTickSequence::new(ta0.borrow_mut(), None, None);

            // Verify start range is ok at start-tick-index
            let (start_range_array_index, start_range_result_index) = swap_tick_sequence
                .get_next_initialized_tick_index(
                    TICK_ARRAY_SIZE * (TS_128 as i32) - 40,
                    TS_128,
                    false,
                    0,
                )
                .unwrap();
            assert_eq!(start_range_array_index, 0);
            assert_eq!(start_range_result_index, TICK_ARRAY_SIZE * TS_128 as i32);
        }

        #[test]
        #[should_panic(expected = "InvalidTickArraySequence")]
        /// In an a_to_b search, search will panic if search index is on the last tick in array + 1
        fn range_panic_on_end_range_plus_one() {
            let ta0 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let ta1 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let ta2 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let last_tick_in_array_plus_one = TICK_ARRAY_SIZE * TS_8 as i32;
            let (_, _) = swap_tick_sequence
                .get_next_initialized_tick_index(last_tick_in_array_plus_one, TS_8, true, 1)
                .unwrap();
        }

        #[test]
        #[should_panic(expected = "InvalidTickArraySequence")]
        /// In an a_to_b search, search will panic if search index is on the first tick in array - 1
        fn range_panic_on_start_range_sub_one() {
            let ta0 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let ta1 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let ta2 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let (_, _) = swap_tick_sequence
                .get_next_initialized_tick_index(-1, TS_8, true, 2)
                .unwrap();
        }
    }
    mod b_to_a {
        use super::*;

        #[test]
        /// In an b_to_a search, the search-range of a tick-array is between the last usable tick in the last array
        /// & the last usable tick in this array minus one.
        fn search_range() {
            let ta0 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let swap_tick_sequence = SwapTickSequence::new(ta0.borrow_mut(), None, None);

            // Verify start range is ok at start-tick-index
            let (start_range_array_index, start_range_result_index) = swap_tick_sequence
                .get_next_initialized_tick_index(-(TS_8 as i32), TS_8, false, 0)
                .unwrap();
            assert_eq!(start_range_result_index, 0);
            assert_eq!(start_range_array_index, 0);

            // Verify search is ok at the last tick-index in array
            let last_searchable_tick_in_array = LAST_TICK_OFFSET as i32 * TS_8 as i32 - 1;
            let last_usable_tick_in_array = LAST_TICK_OFFSET as i32 * TS_8 as i32;
            let (end_range_array_index, end_range_result_index) = swap_tick_sequence
                .get_next_initialized_tick_index(last_searchable_tick_in_array, TS_8, false, 0)
                .unwrap();
            assert_eq!(end_range_result_index, last_usable_tick_in_array);
            assert_eq!(end_range_array_index, 0);
        }

        #[test]
        #[should_panic(expected = "InvalidTickArraySequence")]
        /// In an b_to_a search, search will panic if search index is on the last usable tick
        fn range_panic_on_end_range_plus_one() {
            let ta0 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let swap_tick_sequence = SwapTickSequence::new(ta0.borrow_mut(), None, None);

            let last_searchable_tick_in_array_plus_one = LAST_TICK_OFFSET as i32 * TS_8 as i32;
            let (_, _) = swap_tick_sequence
                .get_next_initialized_tick_index(
                    last_searchable_tick_in_array_plus_one,
                    TS_8,
                    false,
                    0,
                )
                .unwrap();
        }

        #[test]
        #[should_panic(expected = "InvalidTickArraySequence")]
        /// In an b_to_a search, search will panic if search index is less than the last usable tick in the previous tick-array
        fn range_panic_on_start_range_sub_one() {
            let ta0 = build_tick_array(0, vec![0, LAST_TICK_OFFSET]);
            let swap_tick_sequence = SwapTickSequence::new(ta0.borrow_mut(), None, None);

            let (_, _) = swap_tick_sequence
                .get_next_initialized_tick_index(-(TS_8 as i32) - 1, TS_8, false, 0)
                .unwrap();
        }
    }

    mod tick_bound {
        use super::*;

        /// SwapTickSequence will bound the ticks by tick-array, not max/min tick. This is to reduce duplicated responsibility
        /// between thsi & the swap loop / compute_swap.

        #[test]
        fn b_to_a_search_reaching_max_tick() {
            let ta0 = build_tick_array(0, vec![]);
            let ta1 = build_tick_array(0, vec![]);
            let ta2 = build_tick_array(443520, vec![]); // Max(443636).div_floor(tick-spacing (8) * TA Size (72))* tick-spacing (8) *  TA Size (72)
            let swap_tick_sequence = SwapTickSequence::new(
                ta0.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta2.borrow_mut()),
            );

            let (array_index, index) = swap_tick_sequence
                .get_next_initialized_tick_index(443521, TS_8, false, 2)
                .unwrap();

            assert_eq!(index, 443636);
            assert_eq!(array_index, 2);
        }

        #[test]
        fn a_to_b_search_reaching_min_tick() {
            let ta0 = build_tick_array(0, vec![]);
            let ta1 = build_tick_array(0, vec![]);
            let ta2 = build_tick_array(-444096, vec![]); // Min(-443636).div_ceil(tick-spacing (8) * TA Size (72)) * tick-spacing (8) * TA Size (72)
            let swap_tick_sequence = SwapTickSequence::new(
                ta2.borrow_mut(),
                Some(ta1.borrow_mut()),
                Some(ta0.borrow_mut()),
            );

            let (array_index, index) = swap_tick_sequence
                .get_next_initialized_tick_index(-443521, TS_8, true, 0)
                .unwrap();

            assert_eq!(index, -443636);
            assert_eq!(array_index, 0);
        }
    }

    #[test]
    /// Search index on an initialized tick index will return that tick in a a_to_b search
    /// Expect:
    ///     - The same tick will be returned if search index is an initialized tick
    fn a_to_b_search_on_initialized_index() {
        let ta0 = build_tick_array(9216, vec![]);
        let ta1 = build_tick_array(0, vec![25, 71]);
        let ta2 = build_tick_array(-9216, vec![25, 35, 56]);
        let swap_tick_sequence = SwapTickSequence::new(
            ta0.borrow_mut(),
            Some(ta1.borrow_mut()),
            Some(ta2.borrow_mut()),
        );

        let (array_index, index) = swap_tick_sequence
            .get_next_initialized_tick_index(9088, TS_128, true, 1)
            .unwrap();
        assert_eq!(index, 9088);
        assert_eq!(array_index, 1);

        let tick = swap_tick_sequence
            .get_tick(array_index, index, TS_128)
            .unwrap();
        assert!(tick.initialized);
    }

    #[test]
    /// a-to-b search through the entire tick-array sequence
    ///
    /// Verifies:
    ///     - Search index will not return previous initialized indicies in a b_to_a search
    ///     - If the search reaches the end of the last tick array, return the first tick index of the last tick array
    fn a_to_b_search_entire_range() {
        let ta0 = build_tick_array(9216, vec![]);
        let ta1 = build_tick_array(0, vec![25, 71]);
        let ta2 = build_tick_array(-9216, vec![25, 35, 56]);
        let swap_tick_sequence = SwapTickSequence::new(
            ta0.borrow_mut(),
            Some(ta1.borrow_mut()),
            Some(ta2.borrow_mut()),
        );

        let mut search_index = 18431;
        let mut curr_array_index = 0;

        let expectation = [
            (9088, 1, true),
            (3200, 1, true),
            (-2048, 2, true),
            (-4736, 2, true),
            (-6016, 2, true),
            (-9216, 2, false),
        ];

        for expected in expectation.iter() {
            let (array_index, index) = swap_tick_sequence
                .get_next_initialized_tick_index(search_index, TS_128, true, curr_array_index)
                .unwrap();

            assert_eq!(index, expected.0);
            assert_eq!(array_index, expected.1);

            let tick = swap_tick_sequence
                .get_tick(array_index, index, TS_128)
                .unwrap();
            assert_eq!(tick.initialized, expected.2);

            // users on a_to_b search must manually decrement since a_to_b is inclusive of current-tick
            search_index = index - 1;
            curr_array_index = array_index;
        }
    }

    #[test]
    /// b-to-a search through the entire tick-array sequence
    ///
    /// Verifies:
    ///     - Search index on an initialized tick index will not return that tick in a b_to_a search
    ///     - Search index will not return previous initialized indicies in a b_to_a search
    ///     - Search indicies within the shifted range (-tick-spacing prior to the start-tick) will
    ///       return a valid initialized tick
    ///     - If the search reaches the last tick array, return the last tick in the last tick array
    fn b_to_a_search_entire_range() {
        let ta0 = build_tick_array(0, vec![10, 25]);
        let ta1 = build_tick_array(704, vec![]);
        let ta2 = build_tick_array(1408, vec![10, 50, 25]);
        let swap_tick_sequence = SwapTickSequence::new(
            ta0.borrow_mut(),
            Some(ta1.borrow_mut()),
            Some(ta2.borrow_mut()),
        );

        let mut search_index = -7;
        let mut curr_array_index = 0;

        let expectation = [
            (80, 0, true),
            (200, 0, true),
            (1488, 2, true),
            (1608, 2, true),
            (1808, 2, true),
            (2111, 2, false),
        ];

        for expected in expectation.iter() {
            let (array_index, index) = swap_tick_sequence
                .get_next_initialized_tick_index(search_index, TS_8, false, curr_array_index)
                .unwrap();

            assert_eq!(index, expected.0);
            assert_eq!(array_index, expected.1);

            let mut tick_initialized = false;
            if Tick::check_is_usable_tick(index, TS_8) {
                tick_initialized = swap_tick_sequence
                    .get_tick(array_index, index, TS_8)
                    .unwrap()
                    .initialized;
            };
            assert_eq!(tick_initialized, expected.2);

            search_index = index;
            curr_array_index = array_index;
        }
    }

    #[test]
    #[should_panic(expected = "InvalidTickArraySequence")]
    /// The starting point of a swap should always be contained within the first array
    /// Expected:
    ///     - Panic on InvalidTickArraySequence on 1st array
    fn array_0_out_of_sequence() {
        let ta0 = build_tick_array(0, vec![10, 25]);
        let ta1 = build_tick_array(720, vec![53, 71]);
        let ta2 = build_tick_array(1440, vec![10, 50, 25]);
        let swap_tick_sequence = SwapTickSequence::new(
            ta1.borrow_mut(),
            Some(ta0.borrow_mut()),
            Some(ta2.borrow_mut()),
        );

        let mut search_index = -5;
        let mut curr_array_index = 0;

        for _ in 0..10 {
            let (array_index, index) = swap_tick_sequence
                .get_next_initialized_tick_index(search_index, TS_8, false, curr_array_index)
                .unwrap();

            search_index = index;
            curr_array_index = array_index;
        }
    }

    #[test]
    #[should_panic(expected = "InvalidTickArraySequence")]
    /// Search sequence will be successful up until invalid tick array sequence
    ///
    /// Expected:
    ///     - Does not panic when traversing tick-array 0
    ///     - Panic on InvalidTickArraySequence when search-sequence is not in array 1's range
    fn array_1_out_of_sequence() {
        let ta0 = build_tick_array(-576, vec![10]);
        let ta1 = build_tick_array(0, vec![10]);
        let ta2 = build_tick_array(576, vec![25]);
        let swap_tick_sequence = SwapTickSequence::new(
            ta2.borrow_mut(),
            Some(ta0.borrow_mut()),
            Some(ta1.borrow_mut()),
        );

        let mut search_index = 1439;
        let mut curr_array_index = 0;
        let expectation = [(776, 0, true), (576, 0, false), (80, 0, true)];

        for expected in expectation.iter() {
            let (array_index, index) = swap_tick_sequence
                .get_next_initialized_tick_index(search_index, TS_8, true, curr_array_index)
                .unwrap();

            assert_eq!(index, expected.0);
            assert_eq!(array_index, expected.1);

            let tick = swap_tick_sequence
                .get_tick(array_index, index, TS_8)
                .unwrap();
            assert_eq!(tick.initialized, expected.2);

            search_index = index - 1;
            curr_array_index = array_index;
        }
    }
}
