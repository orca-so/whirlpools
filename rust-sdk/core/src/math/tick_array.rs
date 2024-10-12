use crate::{
    ErrorCode, TickArrayFacade, TickFacade, INVALID_TICK_INDEX, TICK_ARRAY_NOT_EVENLY_SPACED,
    TICK_ARRAY_SIZE, TICK_INDEX_OUT_OF_BOUNDS,
};

use super::{get_next_initializable_tick_index, get_prev_initializable_tick_index};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickArraySequence<const SIZE: usize> {
    tick_arrays: [TickArrayFacade; SIZE],
    tick_spacing: u16,
}

impl<const SIZE: usize> TickArraySequence<SIZE> {
    pub fn new(tick_arrays: [TickArrayFacade; SIZE], tick_spacing: u16) -> Result<Self, ErrorCode> {
        let mut tick_arrays = tick_arrays;
        tick_arrays.sort_by(|a, b| a.start_tick_index.cmp(&b.start_tick_index));

        let required_tick_array_spacing: u32 = TICK_ARRAY_SIZE as u32 * tick_spacing as u32;
        for (i, tick_array) in tick_arrays.iter().enumerate() {
            let next_tick_array = tick_arrays.get(i + 1);
            if let Some(next_tick_array) = next_tick_array {
                let first_second_diff =
                    (next_tick_array.start_tick_index - tick_array.start_tick_index).unsigned_abs();
                if first_second_diff != required_tick_array_spacing {
                    return Err(TICK_ARRAY_NOT_EVENLY_SPACED);
                }
            }
        }
        Ok(Self {
            tick_arrays,
            tick_spacing,
        })
    }

    pub fn start_index(&self) -> i32 {
        self.tick_arrays[0].start_tick_index
    }

    pub fn end_index(&self) -> i32 {
        self.tick_arrays[SIZE - 1].start_tick_index
            + TICK_ARRAY_SIZE as i32 * self.tick_spacing as i32
    }

    pub fn tick(&self, tick_index: i32) -> Result<&TickFacade, ErrorCode> {
        if (tick_index < self.start_index()) || (tick_index >= self.end_index()) {
            return Err(TICK_INDEX_OUT_OF_BOUNDS);
        }
        if (tick_index % self.tick_spacing as i32) != 0 {
            return Err(INVALID_TICK_INDEX);
        }
        let tick_array_index = ((tick_index - self.start_index())
            / (TICK_ARRAY_SIZE as i32 * self.tick_spacing as i32))
            as usize;
        let tick_array = &self.tick_arrays[tick_array_index];
        let tick_index_in_array =
            (tick_index - tick_array.start_tick_index) / self.tick_spacing as i32;
        Ok(&tick_array.ticks[tick_index_in_array as usize])
    }

    pub fn next_initialized_tick(&self, tick_index: i32) -> Result<(&TickFacade, i32), ErrorCode> {
        let mut next_index = tick_index;
        loop {
            next_index = get_next_initializable_tick_index(next_index, self.tick_spacing);
            let tick = self.tick(next_index)?;
            if tick.initialized {
                return Ok((tick, next_index));
            }
        }
    }

    pub fn prev_initialized_tick(&self, tick_index: i32) -> Result<(&TickFacade, i32), ErrorCode> {
        let mut prev_index = tick_index;
        loop {
            prev_index = get_prev_initializable_tick_index(prev_index, self.tick_spacing);
            let tick = self.tick(prev_index)?;
            if tick.initialized {
                return Ok((tick, prev_index));
            }
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    fn test_sequence() -> TickArraySequence<3> {
        let ticks: [TickFacade; TICK_ARRAY_SIZE] = (0..TICK_ARRAY_SIZE)
            .map(|x| TickFacade {
                initialized: x & 1 == 1,
                liquidity_net: x as i128,
                ..TickFacade::default()
            })
            .collect::<Vec<TickFacade>>()
            .try_into()
            .unwrap();
        let one = TickArrayFacade {
            start_tick_index: TICK_ARRAY_SIZE as i32 * -16,
            ticks,
        };
        let two = TickArrayFacade {
            start_tick_index: 0,
            ticks,
        };
        let three = TickArrayFacade {
            start_tick_index: TICK_ARRAY_SIZE as i32 * 16,
            ticks,
        };
        TickArraySequence::new([one, two, three], 16).unwrap()
    }

    #[test]
    fn test_tick_array_start_index() {
        let sequence = test_sequence();
        assert_eq!(sequence.start_index(), -1408);
    }

    #[test]
    fn test_tick_array_end_index() {
        let sequence = test_sequence();
        assert_eq!(sequence.end_index(), 2816);
    }

    #[test]
    fn test_get_tick() {
        let sequence = test_sequence();
        assert_eq!(sequence.tick(-1408).unwrap().liquidity_net, 0);
        assert_eq!(sequence.tick(-16).unwrap().liquidity_net, 87);
        assert_eq!(sequence.tick(0).unwrap().liquidity_net, 0);
        assert_eq!(sequence.tick(16).unwrap().liquidity_net, 1);
        assert_eq!(sequence.tick(1408).unwrap().liquidity_net, 0);
        assert_eq!(sequence.tick(1424).unwrap().liquidity_net, 1);
    }

    #[test]
    fn test_get_tick_errors() {
        let sequence = test_sequence();

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
        let sequence = test_sequence();
        let (tick, index) = sequence.next_initialized_tick(0).unwrap();
        assert_eq!(index, 16);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_next_initializable_tick_index_off_spacing() {
        let sequence = test_sequence();
        let (tick, index) = sequence.next_initialized_tick(-17).unwrap();
        assert_eq!(index, -16);
        assert_eq!(tick.liquidity_net, 87);
    }

    #[test]
    fn test_get_next_initializable_tick_cross_array() {
        let sequence = test_sequence();
        let (tick, index) = sequence.next_initialized_tick(1392).unwrap();
        assert_eq!(index, 1424);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_next_initializable_tick_skip_uninitialized() {
        let sequence = test_sequence();
        let (tick, index) = sequence.next_initialized_tick(-1).unwrap();
        assert_eq!(index, 16);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_prev_initializable_tick_index() {
        let sequence = test_sequence();
        let (tick, index) = sequence.prev_initialized_tick(32).unwrap();
        assert_eq!(index, 16);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_prev_initializable_tick_index_off_spacing() {
        let sequence = test_sequence();
        let (tick, index) = sequence.prev_initialized_tick(-1).unwrap();
        assert_eq!(index, -16);
        assert_eq!(tick.liquidity_net, 87);
    }

    #[test]
    fn test_get_prev_initializable_tick_skip_uninitialized() {
        let sequence = test_sequence();
        let (tick, index) = sequence.prev_initialized_tick(33).unwrap();
        assert_eq!(index, 16);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_prev_initializable_tick_cross_array() {
        let sequence = test_sequence();
        let (tick, index) = sequence.prev_initialized_tick(1408).unwrap();
        assert_eq!(index, 1392);
        assert_eq!(tick.liquidity_net, 87);
    }
}
