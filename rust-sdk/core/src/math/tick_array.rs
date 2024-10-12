use crate::{TickArrayFacade, TickFacade, TICK_ARRAY_SIZE};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickArraySequence<const SIZE: usize> {
    tick_arrays: [TickArrayFacade; SIZE],
    tick_spacing: u16,
}

impl<const SIZE: usize> TickArraySequence<SIZE> {
    pub fn new(tick_arrays: [TickArrayFacade; SIZE], tick_spacing: u16) -> Self {
        let mut tick_arrays = tick_arrays;
        tick_arrays.sort_by(|a, b| a.start_tick_index.cmp(&b.start_tick_index));

        let required_tick_array_spacing: u32 = TICK_ARRAY_SIZE as u32 * tick_spacing as u32;
        for (i, tick_array) in tick_arrays.iter().enumerate() {
            let next_tick_array = tick_arrays.get(i + 1);
            if let Some(next_tick_array) = next_tick_array {
                let first_second_diff =
                    (next_tick_array.start_tick_index - tick_array.start_tick_index).unsigned_abs();
                if first_second_diff != required_tick_array_spacing {
                    panic!("tick arrays are not evenly spaced");
                }
            }
        }
        Self {
            tick_arrays,
            tick_spacing,
        }
    }

    pub fn start_index(&self) -> i32 {
        self.tick_arrays[0].start_tick_index
    }

    pub fn end_index(&self) -> i32 {
        let tick_span = TICK_ARRAY_SIZE * 3 * self.tick_spacing as usize;
        self.start_index() + tick_span as i32
    }

    pub fn tick(&self, tick_index: i32) -> &TickFacade {
        if (tick_index < self.start_index()) || (tick_index >= self.end_index()) {
            panic!("tick index out of bounds");
        }
        if (tick_index % self.tick_spacing as i32) != 0 {
            panic!("invalid tick index");
        }
        let tick_array_index = ((tick_index - self.start_index())
            / (TICK_ARRAY_SIZE as i32 * self.tick_spacing as i32))
            as usize;
        let tick_array = &self.tick_arrays[tick_array_index];
        let tick_index_in_array =
            (tick_index - tick_array.start_tick_index) / self.tick_spacing as i32;
        &tick_array.ticks[tick_index_in_array as usize]
    }

    pub fn next_initialized_tick(&self, tick_index: i32) -> (&TickFacade, i32) {
        let remainder = tick_index % self.tick_spacing as i32;
        let next_index = tick_index + self.tick_spacing as i32 - remainder;
        let tick = self.tick(next_index);
        if !tick.initialized {
            return self.next_initialized_tick(next_index);
        }
        (tick, next_index)
    }

    pub fn prev_initialized_tick(&self, tick_index: i32) -> (&TickFacade, i32) {
        let remainder = tick_index % self.tick_spacing as i32;
        let prev_index = tick_index - self.tick_spacing as i32 + remainder;
        let tick = self.tick(prev_index);
        if !tick.initialized {
            return self.prev_initialized_tick(prev_index);
        }
        (tick, prev_index)
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    fn test_sequence() -> TickArraySequence<3> {
        let ticks: [TickFacade; TICK_ARRAY_SIZE] = (0..TICK_ARRAY_SIZE)
            .map(|x| TickFacade {
                initialized: x & 1 == 1,
                ..TickFacade::default()
            })
            .collect::<Vec<TickFacade>>()
            .try_into()
            .unwrap();
        let one = TickArrayFacade {
            start_tick_index: 0,
            ticks,
        };
        let two = TickArrayFacade {
            start_tick_index: TICK_ARRAY_SIZE as i32 * 16,
            ticks,
        };
        let three = TickArrayFacade {
            start_tick_index: TICK_ARRAY_SIZE as i32 * 16 * 2,
            ticks,
        };
        TickArraySequence::new([one, two, three], 16)
    }

    #[test]
    fn test_tick_array_start_index() {
        let sequence = test_sequence();
        assert_eq!(sequence.start_index(), 0);
    }

    #[test]
    fn test_tick_array_end_index() {
        let sequence = test_sequence();
        assert_eq!(sequence.end_index(), 4224);
    }

    #[test]
    fn test_get_tick() {
        let sequence = test_sequence();
        assert_eq!(sequence.tick(0).liquidity_net, 0);
        assert_eq!(sequence.tick(16).liquidity_net, 1);
        assert_eq!(sequence.tick(1408).liquidity_net, 0);
        assert_eq!(sequence.tick(1424).liquidity_net, 1);
    }

    #[test]
    #[should_panic(expected = "tick index out of bounds")]
    fn test_tick_out_of_bounds_below() {
        test_sequence().tick(-1);
    }

    #[test]
    #[should_panic(expected = "tick index out of bounds")]
    fn test_tick_out_of_bounds_above() {
        test_sequence().tick(4225);
    }

    #[test]
    #[should_panic(expected = "invalid tick index")]
    fn test_tick_invalid_index() {
        test_sequence().tick(1);
    }

    #[test]
    fn test_get_next_initializable_tick_index() {
        let sequence = test_sequence();
        let (tick, index) = sequence.next_initialized_tick(0);
        assert_eq!(index, 16);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_next_initializable_tick_cross_array() {
        let sequence = test_sequence();
        let (tick, index) = sequence.next_initialized_tick(1392);
        assert_eq!(index, 1424);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_prev_initializable_tick_index() {
        let sequence = test_sequence();
        let (tick, index) = sequence.prev_initialized_tick(32);
        assert_eq!(index, 16);
        assert_eq!(tick.liquidity_net, 1);
    }

    #[test]
    fn test_get_prev_initializable_tick_cross_array() {
        let sequence = test_sequence();
        let (tick, index) = sequence.prev_initialized_tick(1408);
        assert_eq!(index, 1392);
        assert_eq!(tick.liquidity_net, 87);
    }
}
