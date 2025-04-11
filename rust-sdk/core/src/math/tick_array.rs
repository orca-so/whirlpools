use crate::{
    CoreError, TickArrayFacade, TickFacade, INVALID_TICK_ARRAY_SEQUENCE, INVALID_TICK_INDEX,
    MAX_TICK_INDEX, MIN_TICK_INDEX, TICK_ARRAY_NOT_EVENLY_SPACED, TICK_ARRAY_SIZE,
    TICK_INDEX_OUT_OF_BOUNDS, TICK_SEQUENCE_EMPTY,
};

use super::{
    get_initializable_tick_index, get_next_initializable_tick_index,
    get_prev_initializable_tick_index,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickArraySequence<const SIZE: usize> {
    pub tick_arrays: [Option<TickArrayFacade>; SIZE],
    pub tick_spacing: u16,
}

impl<const SIZE: usize> TickArraySequence<SIZE> {
    pub fn new(
        tick_arrays: [Option<TickArrayFacade>; SIZE],
        tick_spacing: u16,
    ) -> Result<Self, CoreError> {
        let mut tick_arrays = tick_arrays;
        tick_arrays.sort_by_key(start_tick_index);

        if tick_arrays.is_empty() || tick_arrays[0].is_none() {
            return Err(TICK_SEQUENCE_EMPTY);
        }

        let required_tick_array_spacing = TICK_ARRAY_SIZE as i32 * tick_spacing as i32;
        for i in 0..tick_arrays.len() - 1 {
            let current_start_tick_index = start_tick_index(&tick_arrays[i]);
            let next_start_tick_index = start_tick_index(&tick_arrays[i + 1]);
            if next_start_tick_index != <i32>::MAX
                && next_start_tick_index - current_start_tick_index != required_tick_array_spacing
            {
                return Err(TICK_ARRAY_NOT_EVENLY_SPACED);
            }
        }

        Ok(Self {
            tick_arrays,
            tick_spacing,
        })
    }

    /// Returns the first valid tick index in the sequence.
    pub fn start_index(&self) -> i32 {
        start_tick_index(&self.tick_arrays[0]).max(MIN_TICK_INDEX)
    }

    /// Returns the last valid tick index in the sequence.
    pub fn end_index(&self) -> i32 {
        let mut last_valid_start_index = self.start_index();
        for i in 0..self.tick_arrays.len() {
            if start_tick_index(&self.tick_arrays[i]) != <i32>::MAX {
                last_valid_start_index = start_tick_index(&self.tick_arrays[i]);
            }
        }
        let end_index =
            last_valid_start_index + TICK_ARRAY_SIZE as i32 * self.tick_spacing as i32 - 1;
        end_index.min(MAX_TICK_INDEX)
    }

    pub fn tick(&self, tick_index: i32) -> Result<&TickFacade, CoreError> {
        if (tick_index < self.start_index()) || (tick_index > self.end_index()) {
            return Err(TICK_INDEX_OUT_OF_BOUNDS);
        }
        if (tick_index % self.tick_spacing as i32) != 0 {
            return Err(INVALID_TICK_INDEX);
        }
        let first_index = start_tick_index(&self.tick_arrays[0]);
        let tick_array_index = ((tick_index - first_index)
            / (TICK_ARRAY_SIZE as i32 * self.tick_spacing as i32))
            as usize;
        let tick_array_start_index = start_tick_index(&self.tick_arrays[tick_array_index]);
        let tick_array_ticks = ticks(&self.tick_arrays[tick_array_index]);
        let index_in_array = (tick_index - tick_array_start_index) / self.tick_spacing as i32;
        Ok(&tick_array_ticks[index_in_array as usize])
    }

    pub fn next_initialized_tick(
        &self,
        tick_index: i32,
    ) -> Result<(Option<&TickFacade>, i32), CoreError> {
        let array_end_index = self.end_index();
        if tick_index >= array_end_index {
            return Err(INVALID_TICK_ARRAY_SEQUENCE);
        }
        let mut next_index = tick_index;
        loop {
            next_index = get_next_initializable_tick_index(next_index, self.tick_spacing);
            // If at the end of the sequence, we don't have tick info but can still return the next tick index
            if next_index > array_end_index {
                return Ok((None, array_end_index));
            }
            let tick = self.tick(next_index)?;
            if tick.initialized {
                return Ok((Some(tick), next_index));
            }
        }
    }

    pub fn prev_initialized_tick(
        &self,
        tick_index: i32,
    ) -> Result<(Option<&TickFacade>, i32), CoreError> {
        let array_start_index = self.start_index();
        if tick_index < array_start_index {
            return Err(INVALID_TICK_ARRAY_SEQUENCE);
        }
        let mut prev_index =
            get_initializable_tick_index(tick_index, self.tick_spacing, Some(false));
        loop {
            // If at the start of the sequence, we don't have tick info but can still return the previous tick index
            if prev_index < array_start_index {
                return Ok((None, array_start_index));
            }
            let tick = self.tick(prev_index)?;
            if tick.initialized {
                return Ok((Some(tick), prev_index));
            }
            prev_index = get_prev_initializable_tick_index(prev_index, self.tick_spacing);
        }
    }
}

// internal functions

fn start_tick_index(tick_array: &Option<TickArrayFacade>) -> i32 {
    if let Some(tick_array) = tick_array {
        tick_array.start_tick_index
    } else {
        <i32>::MAX
    }
}

fn ticks(tick_array: &Option<TickArrayFacade>) -> &[TickFacade] {
    if let Some(tick_array) = tick_array {
        &tick_array.ticks
    } else {
        &[]
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    fn test_tick(initialized: bool, liquidity_net: i128) -> TickFacade {
        TickFacade {
            initialized,
            liquidity_net,
            ..TickFacade::default()
        }
    }

    fn test_ticks_initialized() -> [TickFacade; TICK_ARRAY_SIZE] {
        (0..TICK_ARRAY_SIZE)
            .map(|x| test_tick(true, x as i128))
            .collect::<Vec<TickFacade>>()
            .try_into()
            .unwrap()
    }

    fn test_ticks_uninitialized() -> [TickFacade; TICK_ARRAY_SIZE] {
        (0..TICK_ARRAY_SIZE)
            .map(|_| test_tick(false, 0))
            .collect::<Vec<TickFacade>>()
            .try_into()
            .unwrap()
    }

    fn test_ticks_alternating_initialized() -> [TickFacade; TICK_ARRAY_SIZE] {
        (0..TICK_ARRAY_SIZE)
            .map(|x| {
                let initialized = x & 1 == 1;
                test_tick(initialized, if initialized { x as i128 } else { 0 })
            })
            .collect::<Vec<TickFacade>>()
            .try_into()
            .unwrap()
    }

    fn test_sequence_with_one_tick_array(
        tick_spacing: u16,
        ticks: [TickFacade; TICK_ARRAY_SIZE],
        start_tick_index: i32,
    ) -> TickArraySequence<5> {
        let one = TickArrayFacade {
            start_tick_index,
            ticks,
        };
        TickArraySequence::new([Some(one), None, None, None, None], tick_spacing).unwrap()
    }

    fn test_sequence(
        tick_spacing: u16,
        ticks: [TickFacade; TICK_ARRAY_SIZE],
    ) -> TickArraySequence<5> {
        let one = TickArrayFacade {
            start_tick_index: -(TICK_ARRAY_SIZE as i32 * tick_spacing as i32),
            ticks,
        };
        let two = TickArrayFacade {
            start_tick_index: 0,
            ticks,
        };
        let three = TickArrayFacade {
            start_tick_index: TICK_ARRAY_SIZE as i32 * tick_spacing as i32,
            ticks,
        };
        TickArraySequence::new(
            [Some(one), Some(two), Some(three), None, None],
            tick_spacing,
        )
        .unwrap()
    }

    #[test]
    fn test_tick_array_start_index() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        assert_eq!(sequence.start_index(), -1408);
    }

    #[test]
    fn test_tick_array_end_index() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        assert_eq!(sequence.end_index(), 2815);
    }

    #[test]
    fn test_get_tick() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        assert_eq!(sequence.tick(-1408).map(|x| x.liquidity_net), Ok(0));
        assert_eq!(sequence.tick(-16).map(|x| x.liquidity_net), Ok(87));
        assert_eq!(sequence.tick(0).map(|x| x.liquidity_net), Ok(0));
        assert_eq!(sequence.tick(16).map(|x| x.liquidity_net), Ok(1));
        assert_eq!(sequence.tick(1408).map(|x| x.liquidity_net), Ok(0));
        assert_eq!(sequence.tick(1424).map(|x| x.liquidity_net), Ok(1));
    }

    #[test]
    fn test_get_tick_large_tick_spacing() {
        let sequence: TickArraySequence<5> =
            test_sequence(32896, test_ticks_alternating_initialized());
        assert_eq!(sequence.tick(-427648).map(|x| x.liquidity_net), Ok(75));
        assert_eq!(sequence.tick(0).map(|x| x.liquidity_net), Ok(0));
        assert_eq!(sequence.tick(427648).map(|x| x.liquidity_net), Ok(13));
    }

    #[test]
    fn test_get_tick_errors() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());

        let out_out_bounds_lower = sequence.tick(-1409);
        assert!(matches!(
            out_out_bounds_lower,
            Err(TICK_INDEX_OUT_OF_BOUNDS)
        ));

        let out_of_bounds_upper = sequence.tick(2817);
        assert!(matches!(out_of_bounds_upper, Err(TICK_INDEX_OUT_OF_BOUNDS)));

        let invalid_tick_index = sequence.tick(1);
        assert!(matches!(invalid_tick_index, Err(INVALID_TICK_INDEX)));

        let invalid_negative_tick_index = sequence.tick(-1);
        assert!(matches!(
            invalid_negative_tick_index,
            Err(INVALID_TICK_INDEX)
        ));
    }

    #[test]
    fn test_get_next_initializable_tick_index() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.next_initialized_tick(0);
        assert_eq!(pair.map(|x| x.1), Ok(16));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(1)));
    }

    #[test]
    fn test_get_next_initializable_tick_index_off_spacing() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.next_initialized_tick(-17);
        assert_eq!(pair.map(|x| x.1), Ok(-16));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(87)));
    }

    #[test]
    fn test_get_next_initializable_tick_cross_array() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.next_initialized_tick(1392);
        assert_eq!(pair.map(|x| x.1), Ok(1424));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(1)));
    }

    #[test]
    fn test_get_next_initializable_tick_skip_uninitialized() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.next_initialized_tick(-1);
        assert_eq!(pair.map(|x| x.1), Ok(16));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(1)));
    }

    #[test]
    fn test_get_next_initializable_tick_INVALID_TICK_ARRAY_SEQUENCE() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair_2813 = sequence.next_initialized_tick(2813);
        let pair_2814 = sequence.next_initialized_tick(2814);
        let pair_2815 = sequence.next_initialized_tick(2815);
        let pair_2816 = sequence.next_initialized_tick(2816);
        assert_eq!(pair_2813, Ok((None, 2815)));
        assert_eq!(pair_2814, Ok((None, 2815)));
        assert_eq!(pair_2815, Err(INVALID_TICK_ARRAY_SEQUENCE));
        assert_eq!(pair_2816, Err(INVALID_TICK_ARRAY_SEQUENCE));
    }

    #[test]
    fn test_get_next_initializable_tick_with_last_initializable_tick_initialized() {
        let sequence = test_sequence(16, test_ticks_initialized());
        let pair_2799 = sequence.next_initialized_tick(2799);
        let pair_2800 = sequence.next_initialized_tick(2800);
        assert_eq!(pair_2799, Ok((Some(&test_tick(true, 87)), 2800)));
        assert_eq!(pair_2800, Ok((None, 2815)));
    }

    #[test]
    fn test_get_next_initializable_tick_with_last_initializable_tick_uninitialized() {
        let sequence = test_sequence(16, test_ticks_uninitialized());
        let pair_2799 = sequence.next_initialized_tick(2799);
        assert_eq!(pair_2799, Ok((None, 2815)));
    }

    #[test]
    fn test_get_next_initializable_tick_in_end_tick_array_with_uninitialized_ticks_ts_16() {
        let tick_spacing = 16;
        let start_tick_index = get_tick_array_start_tick_index(MAX_TICK_INDEX, tick_spacing);
        let sequence = test_sequence_with_one_tick_array(
            tick_spacing,
            test_ticks_uninitialized(),
            start_tick_index,
        );
        let pair = sequence.next_initialized_tick(start_tick_index);
        assert_eq!(pair, Ok((None, MAX_TICK_INDEX)));
    }

    #[test]
    fn test_get_next_initializable_tick_in_end_tick_array_with_uninitialized_ticks_ts_1() {
        let tick_spacing = 1;
        let start_tick_index = get_tick_array_start_tick_index(MAX_TICK_INDEX, tick_spacing);
        let sequence = test_sequence_with_one_tick_array(
            tick_spacing,
            test_ticks_uninitialized(),
            start_tick_index,
        );
        let pair = sequence.next_initialized_tick(start_tick_index);
        assert_eq!(pair, Ok((None, MAX_TICK_INDEX)));
    }

    #[test]
    fn test_get_next_initializable_tick_in_end_tick_array_with_initialized_ticks_ts_1() {
        let tick_spacing = 1;
        let start_tick_index = get_tick_array_start_tick_index(MAX_TICK_INDEX, tick_spacing);
        let sequence = test_sequence_with_one_tick_array(
            tick_spacing,
            test_ticks_initialized(),
            start_tick_index,
        );
        let pair = sequence.next_initialized_tick(MAX_TICK_INDEX - 1);
        assert_eq!(pair, Ok((Some(&test_tick(true, 28)), MAX_TICK_INDEX)));
    }

    #[test]
    fn test_get_prev_initializable_tick_index() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.prev_initialized_tick(32);
        assert_eq!(pair.map(|x| x.1), Ok(16));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(1)));
    }

    #[test]
    fn test_get_prev_initializable_tick_index_off_spacing() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.prev_initialized_tick(-1);
        assert_eq!(pair.map(|x| x.1), Ok(-16));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(87)));
    }

    #[test]
    fn test_get_prev_initializable_tick_skip_uninitialized() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.prev_initialized_tick(33);
        assert_eq!(pair.map(|x| x.1), Ok(16));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(1)));
    }

    #[test]
    fn test_get_prev_initializable_tick_cross_array() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair = sequence.prev_initialized_tick(1408);
        assert_eq!(pair.map(|x| x.1), Ok(1392));
        assert_eq!(pair.map(|x| x.0.map(|x| x.liquidity_net)), Ok(Some(87)));
    }

    #[test]
    fn test_get_prev_initialized_tick_INVALID_TICK_ARRAY_SEQUENCE() {
        let sequence = test_sequence(16, test_ticks_alternating_initialized());
        let pair_1407 = sequence.prev_initialized_tick(-1407);
        let pair_1408 = sequence.prev_initialized_tick(-1408);
        let pair_1409 = sequence.prev_initialized_tick(-1409);
        let pair_1410 = sequence.prev_initialized_tick(-1410);
        assert!(matches!(pair_1407, Ok((None, -1408))));
        assert!(matches!(pair_1408, Ok((None, -1408))));
        assert!(matches!(pair_1409, Err(INVALID_TICK_ARRAY_SEQUENCE)));
        assert!(matches!(pair_1410, Err(INVALID_TICK_ARRAY_SEQUENCE)));
    }

    #[test]
    fn test_get_prev_initializable_tick_with_first_initializable_tick_initialized() {
        let sequence = test_sequence(16, test_ticks_initialized());
        let pair = sequence.prev_initialized_tick(-1408);
        assert_eq!(pair, Ok((Some(&test_tick(true, 0)), -1408)));
    }

    #[test]
    fn test_get_prev_initializable_tick_with_first_initializable_tick_uninitialized() {
        let sequence = test_sequence(16, test_ticks_uninitialized());
        let pair = sequence.prev_initialized_tick(-1408);
        assert_eq!(pair, Ok((None, -1408)));
    }

    #[test]
    fn test_get_prev_initializable_tick_in_first_tick_array_with_uninitialized_ticks_ts_16() {
        let tick_spacing = 16;
        let start_tick_index = get_tick_array_start_tick_index(MIN_TICK_INDEX, tick_spacing);
        let sequence = test_sequence_with_one_tick_array(
            tick_spacing,
            test_ticks_uninitialized(),
            start_tick_index,
        );
        let pair = sequence.prev_initialized_tick(MIN_TICK_INDEX + tick_spacing as i32);
        assert_eq!(pair, Ok((None, MIN_TICK_INDEX)));
    }

    #[test]
    fn test_get_prev_initializable_tick_in_first_tick_array_with_uninitialized_ticks_ts_1() {
        let tick_spacing = 1;
        let start_tick_index = get_tick_array_start_tick_index(MIN_TICK_INDEX, tick_spacing);
        let sequence = test_sequence_with_one_tick_array(
            tick_spacing,
            test_ticks_uninitialized(),
            start_tick_index,
        );
        let pair = sequence.prev_initialized_tick(MIN_TICK_INDEX + tick_spacing as i32);
        assert_eq!(pair, Ok((None, MIN_TICK_INDEX)));
    }

    #[test]
    fn test_get_prev_initializable_tick_in_first_tick_array_with_initialized_ticks_ts_1() {
        let tick_spacing = 1;
        let start_tick_index = get_tick_array_start_tick_index(MIN_TICK_INDEX, tick_spacing);
        let sequence = test_sequence_with_one_tick_array(
            tick_spacing,
            test_ticks_initialized(),
            start_tick_index,
        );
        let pair = sequence.prev_initialized_tick(MIN_TICK_INDEX);
        assert_eq!(pair, Ok((Some(&test_tick(true, 60)), MIN_TICK_INDEX)));
    }
}
