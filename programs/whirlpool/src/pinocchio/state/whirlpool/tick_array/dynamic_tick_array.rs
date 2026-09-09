use super::super::super::{BytesI32, BytesU128, Pubkey};
use super::{tick::MemoryMappedTick, TickArray, TickUpdate, TICK_ARRAY_SIZE_USIZE};
use crate::pinocchio::Result;

const DYNAMIC_TICK_INITIALIZED_LEN: usize = 113;
const DYNAMIC_TICK_UNINITIALIZED_LEN: usize = 1;
const TICKS_MAX_USIZE: usize = DYNAMIC_TICK_INITIALIZED_LEN * TICK_ARRAY_SIZE_USIZE;

#[repr(C)]
pub struct MemoryMappedDynamicTickArray {
    discriminator: [u8; 8],

    start_tick_index: BytesI32,
    whirlpool: Pubkey,
    tick_bitmap: BytesU128,
    ticks: [u8; TICKS_MAX_USIZE],
}

impl TickArray for MemoryMappedDynamicTickArray {
    fn is_variable_size(&self) -> bool {
        true
    }

    fn start_tick_index(&self) -> i32 {
        i32::from_le_bytes(self.start_tick_index)
    }

    fn whirlpool(&self) -> &Pubkey {
        &self.whirlpool
    }

    fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<&MemoryMappedTick> {
        let tick_offset = match self.check_is_usable_tick_and_get_offset(tick_index, tick_spacing) {
            Some(offset) => offset,
            None => {
                return Err(crate::errors::ErrorCode::TickNotFound.into());
            }
        };
        let byte_offset = self.byte_offset(tick_offset)?;

        if self.ticks[byte_offset] == 0 {
            Ok(&super::tick::STATIC_ZEROED_MEMORY_MAPPED_TICK)
        } else {
            let tick_bytes = &self.ticks[byte_offset..byte_offset + DYNAMIC_TICK_INITIALIZED_LEN];
            let tick_ptr = tick_bytes.as_ptr() as *const MemoryMappedTick;
            unsafe { Ok(&*tick_ptr) }
        }
    }

    fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()> {
        let tick_offset = match self.check_is_usable_tick_and_get_offset(tick_index, tick_spacing) {
            Some(offset) => offset,
            None => {
                return Err(crate::errors::ErrorCode::TickNotFound.into());
            }
        };
        let byte_offset = self.byte_offset(tick_offset)?;

        let tick_initialized = self.ticks[byte_offset] != 0;

        // If the tick needs to be initialized, we need to right-shift everything after byte_offset by DynamicTickData::LEN
        if !tick_initialized && update.initialized {
            let current_len = self.ticks_len();
            let extended_len = current_len + crate::state::DynamicTickData::LEN;
            let ticks_slice = &mut self.ticks[0..extended_len];

            let copy_src_offset = byte_offset + 1;
            let copy_dest_offset = copy_src_offset + crate::state::DynamicTickData::LEN;
            ticks_slice.copy_within(copy_src_offset..current_len, copy_dest_offset);

            // sync bitmap
            self.update_tick_bitmap(tick_offset, true);
        }

        // If the tick needs to be uninitialized, we need to left-shift everything after byte_offset by DynamicTickData::LEN
        if tick_initialized && !update.initialized {
            let current_len = self.ticks_len();
            let ticks_slice = &mut self.ticks[0..current_len];

            let copy_dest_offset = byte_offset + 1;
            let copy_src_offset = copy_dest_offset + crate::state::DynamicTickData::LEN;
            ticks_slice.copy_within(copy_src_offset..current_len, copy_dest_offset);

            // sync bitmap
            self.update_tick_bitmap(tick_offset, false);
        }

        // Update the tick data at byte_offset
        if !update.initialized {
            // If the tick is being uninitialized, we are done
            self.ticks[byte_offset] = 0;
        } else {
            // map MemoryMappedTick and update
            let tick_bytes = &mut self.ticks
                [byte_offset..byte_offset + crate::state::DynamicTick::INITIALIZED_LEN];
            let tick_ptr = tick_bytes.as_mut_ptr() as *mut MemoryMappedTick;
            let tick = unsafe { &mut *tick_ptr };
            tick.update(update);
        }

        Ok(())
    }
}

impl MemoryMappedDynamicTickArray {
    fn byte_offset(&self, tick_offset: usize) -> Result<usize> {
        let tick_bitmap = self.tick_bitmap();
        let mask = (1u128 << tick_offset) - 1;
        let initialized_ticks = (tick_bitmap & mask).count_ones() as usize;
        let uninitialized_ticks = tick_offset - initialized_ticks;

        let offset = initialized_ticks * DYNAMIC_TICK_INITIALIZED_LEN
            + uninitialized_ticks * DYNAMIC_TICK_UNINITIALIZED_LEN;
        Ok(offset)
    }

    fn tick_bitmap(&self) -> u128 {
        u128::from_le_bytes(self.tick_bitmap)
    }

    fn ticks_len(&self) -> usize {
        let initialized_ticks = self.tick_bitmap().count_ones() as usize;
        let uninitialized_ticks = TICK_ARRAY_SIZE_USIZE - initialized_ticks;

        initialized_ticks * DYNAMIC_TICK_INITIALIZED_LEN
            + uninitialized_ticks * DYNAMIC_TICK_UNINITIALIZED_LEN
    }

    fn update_tick_bitmap(&mut self, tick_offset: usize, initialized: bool) {
        let mut tick_bitmap = self.tick_bitmap();
        if initialized {
            tick_bitmap |= 1 << tick_offset;
        } else {
            tick_bitmap &= !(1 << tick_offset);
        }
        self.tick_bitmap = tick_bitmap.to_le_bytes();
    }
}

#[cfg(test)]
mod array_update_tests {
    use crate::pinocchio::state::whirlpool::TICK_ARRAY_SIZE;
    use crate::state::DynamicTick;
    use super::*;

    impl MemoryMappedDynamicTickArray {
        fn set_initialized_tick(&mut self, byte_offset: usize, update: TickUpdate) {
            let tick_bytes = &mut self.ticks[byte_offset..byte_offset + DynamicTick::INITIALIZED_LEN];
            let tick_ptr = tick_bytes.as_mut_ptr() as *mut MemoryMappedTick;
            let tick = unsafe { &mut *tick_ptr };
            tick.update(&update);
        }

        fn set_tick_bitmap(&mut self, tick_bitmap: u128) {
            self.tick_bitmap.copy_from_slice(&tick_bitmap.to_le_bytes());
        }

        fn is_tick_bitmap_on(&self, tick_index: i32, tick_spacing: u16) -> bool {
            let bitmap = self.tick_bitmap();
            let tick_offset = self.tick_offset(tick_index, tick_spacing).unwrap();
            (bitmap & (1 << tick_offset)) != 0
        }

        fn is_tick_bitmap_off(&self, tick_index: i32, tick_spacing: u16) -> bool {
            !self.is_tick_bitmap_on(tick_index, tick_spacing)
        }
    }

    fn initialized_tick() -> TickUpdate {
        TickUpdate {
            initialized: true,
            liquidity_net: 123,
            liquidity_gross: 456,
            fee_growth_outside_a: 678,
            fee_growth_outside_b: 901,
            reward_growths_outside: [234, 567, 890],
        }
    }

    fn uninitialized_tick() -> TickUpdate {
        TickUpdate::default()
    }

    fn tick_array() -> MemoryMappedDynamicTickArray {
        let mut array = MemoryMappedDynamicTickArray {
            discriminator: [0u8; 8],
            start_tick_index: [0u8; 4],
            whirlpool: [0u8; 32],
            tick_bitmap: [0u8; 16],
            ticks: [0u8; TICKS_MAX_USIZE],
        };

        // init every other tick
        let mut offset = 0;
        let mut tick_bitmap: u128 = 0;
        for i in 0..TICK_ARRAY_SIZE {
            let initialized = offset % 2 == 0;

            let tick_len = if initialized {
                DynamicTick::INITIALIZED_LEN
            } else {
                DynamicTick::UNINITIALIZED_LEN
            };

            if initialized {
                let tick_update = initialized_tick();
                array.set_initialized_tick(offset, tick_update);
            };

            offset += tick_len;

            if initialized {
                tick_bitmap |= 1 << i;
            }
        }

        array.set_tick_bitmap(tick_bitmap);

        array
    }

    fn memory_mapped_tick_eq_tick_update(
        tick: &MemoryMappedTick,
        tick_update: &TickUpdate
    ) -> bool {
        tick.initialized() == tick_update.initialized
            && tick.liquidity_net() == tick_update.liquidity_net
            && tick.liquidity_gross() == tick_update.liquidity_gross
            && tick.fee_growth_outside_a() == tick_update.fee_growth_outside_a
            && tick.fee_growth_outside_b() == tick_update.fee_growth_outside_b
            && tick.reward_growths_outside() == tick_update.reward_growths_outside
    }

    #[test]
    fn update_applies_successfully() {
        let update_index = 8;
        let mut array = tick_array();

        let before = array.get_tick(update_index, 1).unwrap();
        assert!(memory_mapped_tick_eq_tick_update(before, &initialized_tick()));
        assert!(array.is_tick_bitmap_on(update_index, 1));

        let new_tick = TickUpdate {
            initialized: true,
            liquidity_net: 24128472184712i128,
            liquidity_gross: 353873892732u128,
            fee_growth_outside_a: 3928372892u128,
            fee_growth_outside_b: 12242u128,
            reward_growths_outside: [53264u128, 539282u128, 98744u128],
        };

        array.update_tick(update_index, 1, &new_tick).unwrap();

        assert_eq!(array.start_tick_index(), 0);
        assert_eq!(*array.whirlpool(), Pubkey::default());

        for i in 0..TICK_ARRAY_SIZE {
            let tick = array.get_tick(i, 1).unwrap();
            if i == update_index {
                assert!(memory_mapped_tick_eq_tick_update(tick, &new_tick));
                assert!(array.is_tick_bitmap_on(i, 1));
            } else if i % 2 == 0 {
                assert!(memory_mapped_tick_eq_tick_update(tick, &initialized_tick()));
                assert!(array.is_tick_bitmap_on(i, 1));
            } else {
                assert!(memory_mapped_tick_eq_tick_update(tick, &uninitialized_tick()));
                assert!(array.is_tick_bitmap_off(i, 1));
            }
        }
    }

    #[test]
    fn initialize_tick_successfully() {
        let mut array = tick_array();
        let tick_index = 7;

        let before = array.get_tick(tick_index, 1).unwrap();
        assert!(memory_mapped_tick_eq_tick_update(before, &uninitialized_tick()));
        assert!(array.is_tick_bitmap_off(tick_index, 1));

        array
            .update_tick(tick_index, 1, &initialized_tick())
            .unwrap();

        assert_eq!(array.start_tick_index(), 0);
        assert_eq!(*array.whirlpool(), Pubkey::default());

        for i in 0..TICK_ARRAY_SIZE {
            let tick = array.get_tick(i, 1).unwrap();
            if i == tick_index || i % 2 == 0 {
                assert!(memory_mapped_tick_eq_tick_update(tick, &initialized_tick()));
                assert!(array.is_tick_bitmap_on(i, 1));
            } else {
                assert!(memory_mapped_tick_eq_tick_update(tick, &uninitialized_tick()));
                assert!(array.is_tick_bitmap_off(i, 1));
            }
        }
    }

    #[test]
    fn uninitialize_tick_successfully() {
        let mut array = tick_array();
        let tick_index = 8;

        let before = array.get_tick(tick_index, 1).unwrap();
        assert!(memory_mapped_tick_eq_tick_update(before, &initialized_tick()));
        assert!(array.is_tick_bitmap_on(tick_index, 1));

        array
            .update_tick(tick_index, 1, &uninitialized_tick())
            .unwrap();

        assert_eq!(array.start_tick_index(), 0);
        assert_eq!(*array.whirlpool(), Pubkey::default());

        for i in 0..TICK_ARRAY_SIZE {
            let tick = array.get_tick(i, 1).unwrap();
            if i % 2 == 0 && i != tick_index {
                assert!(memory_mapped_tick_eq_tick_update(tick, &initialized_tick()));
                assert!(array.is_tick_bitmap_on(i, 1));
            } else {
                assert!(memory_mapped_tick_eq_tick_update(tick, &uninitialized_tick()));
                assert!(array.is_tick_bitmap_off(i, 1));
            }
        }
    }

    mod initialize_all_ticks_then_uninitialize_all_ticks {
        use super::*;

        const ASC: [usize; TICK_ARRAY_SIZE_USIZE] = [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
            46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67,
            68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
        ];
        const DESC: [usize; TICK_ARRAY_SIZE_USIZE] = [
            87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66,
            65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44,
            43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22,
            21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
        ];

        const PINGPONG: [usize; TICK_ARRAY_SIZE_USIZE] = [
            0, 87, 1, 86, 2, 85, 3, 84, 4, 83, 5, 82, 6, 81, 7, 80, 8, 79, 9, 78, 10, 77, 11, 76,
            12, 75, 13, 74, 14, 73, 15, 72, 16, 71, 17, 70, 18, 69, 19, 68, 20, 67, 21, 66, 22, 65,
            23, 64, 24, 63, 25, 62, 26, 61, 27, 60, 28, 59, 29, 58, 30, 57, 31, 56, 32, 55, 33, 54,
            34, 53, 35, 52, 36, 51, 37, 50, 38, 49, 39, 48, 40, 47, 41, 46, 42, 45, 43, 44,
        ];
        const PONGPING: [usize; TICK_ARRAY_SIZE_USIZE] = [
            44, 43, 45, 42, 46, 41, 47, 40, 48, 39, 49, 38, 50, 37, 51, 36, 52, 35, 53, 34, 54, 33,
            55, 32, 56, 31, 57, 30, 58, 29, 59, 28, 60, 27, 61, 26, 62, 25, 63, 24, 64, 23, 65, 22,
            66, 21, 67, 20, 68, 19, 69, 18, 70, 17, 71, 16, 72, 15, 73, 14, 74, 13, 75, 12, 76, 11,
            77, 10, 78, 9, 79, 8, 80, 7, 81, 6, 82, 5, 83, 4, 84, 3, 85, 2, 86, 1, 87, 0,
        ];

        const ALL_UNINITIALIZED_BITMAP: u128 = 0;
        const ALL_INITIALIZED_BITMAP: u128 = 309485009821345068724781055; // 2^88 - 1
        const STATIC_FIELD_LEN: usize = 8 // discriminator
                    + 4 // start_tick_index
                    + 32 // whirlpool
                    + 16; // tick_bitmap

        fn initialized_tick(offset: usize) -> TickUpdate {
            TickUpdate {
                initialized: true,
                liquidity_net: 0x11002233445566778899aabbccddeeffi128 + offset as i128,
                liquidity_gross: 0xff00eeddccbbaa998877665544332211u128 + offset as u128,
                fee_growth_outside_a: 0x11220033445566778899aabbccddeeffu128 + offset as u128,
                fee_growth_outside_b: 0xffee00ddccbbaa998877665544332211u128 + offset as u128,
                reward_growths_outside: [
                    0x11223300445566778899aabbccddeeffu128 + offset as u128,
                    0x11223344005566778899aabbccddeeffu128 + offset as u128,
                    0x11223344550066778899aabbccddeeffu128 + offset as u128,
                ],
            }
        }

        fn offset_to_tick_index(offset: usize, start_tick_index: i32, tick_spacing: u16) -> i32 {
            start_tick_index + tick_spacing as i32 * offset as i32
        }

        fn test(
            start_tick_index: i32,
            tick_spacing: u16,
            initialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
            uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
        ) {
            let whirlpool = anchor_lang::solana_program::pubkey::Pubkey::new_unique();

            let rand_u8_for_initialize = whirlpool.as_array()[16];
            let rand_u8_for_uninitialize = whirlpool.as_array()[17];

            let mut buf = [0u8; crate::state::DynamicTickArray::MAX_LEN];

            // note: buf[0..8]: discriminator
            buf[8..12].copy_from_slice(&start_tick_index.to_le_bytes());
            buf[12..44].copy_from_slice(&whirlpool.to_bytes());

            // cast
            let array = unsafe {
                &mut *(buf.as_mut_ptr() as *mut MemoryMappedDynamicTickArray)
            };

            // all ticks are not initialized            
            assert!(array.whirlpool() == &whirlpool.to_bytes());
            assert!(array.start_tick_index() == start_tick_index);
            assert!(array.tick_bitmap() == ALL_UNINITIALIZED_BITMAP);
            for offset in 0..TICK_ARRAY_SIZE_USIZE {
                assert!(
                    !array
                        .get_tick(
                            offset_to_tick_index(offset, start_tick_index, tick_spacing),
                            tick_spacing
                        )
                        .unwrap()
                        .initialized()
                );
            }

            // initialize all ticks
            let mut initialized = 0;
            let mut bitmap = ALL_UNINITIALIZED_BITMAP;
            let mut account_len = STATIC_FIELD_LEN + DynamicTick::UNINITIALIZED_LEN * TICK_ARRAY_SIZE_USIZE;
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let offset = initialize_order[i];
                let tick_index = offset_to_tick_index(offset, start_tick_index, tick_spacing);

                account_len += crate::state::DynamicTickData::LEN;
                
                // dirty write to non-allocated buf range
                buf[account_len..].fill(rand_u8_for_initialize);

                // initialize
                array
                    .update_tick(tick_index, tick_spacing, &initialized_tick(offset))
                    .unwrap();

                // check that the dirty write is not overwritten
                assert!(buf[account_len..].iter().all(|&b| b == rand_u8_for_initialize));

                initialized += 1;
                let uninitialized = TICK_ARRAY_SIZE_USIZE - initialized;

                bitmap |= 1 << offset;

                let allocated_buf_size = STATIC_FIELD_LEN
                    + DynamicTick::INITIALIZED_LEN * initialized
                    + DynamicTick::UNINITIALIZED_LEN * uninitialized;
                assert_eq!(allocated_buf_size, account_len);

                // clear not-allocated buf range
                buf[allocated_buf_size..].fill(0u8);

                // check state
                assert!(array.whirlpool() == &whirlpool.to_bytes());
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in initialize_order.iter().take(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(tick.initialized());
                    assert!(memory_mapped_tick_eq_tick_update(&tick, &initialized_tick(*offset)));
                }

                // dirty write to non-allocated buf range
                buf[allocated_buf_size..].fill(255u8);

                assert!(array.whirlpool() == &whirlpool.to_bytes());
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in initialize_order.iter().skip(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(!tick.initialized());
                    assert!(memory_mapped_tick_eq_tick_update(&tick, &uninitialized_tick()));
                }
            }

            // all ticks are initialized
            assert!(array.whirlpool() == &whirlpool.to_bytes());
            assert!(array.start_tick_index() == start_tick_index);
            assert!(array.tick_bitmap() == ALL_INITIALIZED_BITMAP);
            for offset in 0..TICK_ARRAY_SIZE_USIZE {
                assert!(
                    array
                        .get_tick(
                            offset_to_tick_index(offset, start_tick_index, tick_spacing),
                            tick_spacing
                        )
                        .unwrap()
                        .initialized()
                );
            }

            // uninitialize all ticks
            let mut uninitialized = 0;
            let mut bitmap = ALL_INITIALIZED_BITMAP;
            let mut account_len = STATIC_FIELD_LEN + DynamicTick::INITIALIZED_LEN * TICK_ARRAY_SIZE_USIZE;
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let offset = uninitialize_order[i];
                let tick_index = offset_to_tick_index(offset, start_tick_index, tick_spacing);

                // dirty write to non-allocated buf range
                buf[account_len..].fill(rand_u8_for_uninitialize);

                // uninitialize
                array
                    .update_tick(tick_index, tick_spacing, &uninitialized_tick())
                    .unwrap();

                // check that the dirty write is not overwritten
                assert!(buf[account_len..].iter().all(|&b| b == rand_u8_for_uninitialize));

                account_len -= crate::state::DynamicTickData::LEN;

                uninitialized += 1;
                let initialized = TICK_ARRAY_SIZE_USIZE - uninitialized;

                bitmap &= !(1 << offset);

                let allocated_buf_size = STATIC_FIELD_LEN
                    + DynamicTick::INITIALIZED_LEN * initialized
                    + DynamicTick::UNINITIALIZED_LEN * uninitialized;
                assert_eq!(allocated_buf_size, account_len);

                // dirty write to non-allocated buf range
                buf[allocated_buf_size..].fill(255u8);

                // check state
                assert!(array.whirlpool() == &whirlpool.to_bytes());
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in uninitialize_order.iter().take(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(!tick.initialized());
                    assert!(memory_mapped_tick_eq_tick_update(&tick, &uninitialized_tick()));
                }

                // clear not-allocated buf range
                buf[allocated_buf_size..].fill(0u8);

                assert!(array.whirlpool() == &whirlpool.to_bytes());
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in uninitialize_order.iter().skip(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(tick.initialized());
                    assert!(memory_mapped_tick_eq_tick_update(&tick, &initialized_tick(*offset)));
                }
            }

            // all ticks are not initialized
            assert!(array.whirlpool() == &whirlpool.to_bytes());
            assert!(array.start_tick_index() == start_tick_index);
            assert!(array.tick_bitmap() == ALL_UNINITIALIZED_BITMAP);
            for offset in 0..TICK_ARRAY_SIZE_USIZE {
                assert!(
                    !array
                        .get_tick(
                            offset_to_tick_index(offset, start_tick_index, tick_spacing),
                            tick_spacing
                        )
                        .unwrap()
                        .initialized()
                );
            }
        }

        fn tests(
            initialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
            uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
        ) {
            test(-176, 1, initialize_order, uninitialize_order);
            test(176, 1, initialize_order, uninitialize_order);
            test(-28160, 64, initialize_order, uninitialize_order);
            test(28160, 64, initialize_order, uninitialize_order);
        }

        #[test]
        fn asc_asc() {
            tests(ASC, ASC);
        }

        #[test]
        fn asc_desc() {
            tests(ASC, DESC);
        }

        #[test]
        fn desc_asc() {
            tests(DESC, ASC);
        }

        #[test]
        fn desc_desc() {
            tests(DESC, DESC);
        }

        #[test]
        fn pingpong_pingpong() {
            tests(PINGPONG, PINGPONG);
        }

        #[test]
        fn pingpong_pongping() {
            tests(PINGPONG, PONGPING);
        }

        #[test]
        fn pongping_pingpong() {
            tests(PONGPING, PINGPONG);
        }

        #[test]
        fn pongping_pongping() {
            tests(PONGPING, PONGPING);
        }

        #[test]
        fn random_random_one() {
            // generated random order
            let initialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                87, 81, 73, 4, 64, 83, 49, 35, 86, 58, 45, 62, 66, 51, 84, 8, 3, 14, 63, 68, 43,
                27, 71, 67, 60, 85, 34, 19, 56, 21, 20, 65, 77, 48, 57, 23, 41, 7, 17, 12, 36, 16,
                22, 52, 69, 55, 18, 44, 24, 28, 47, 6, 13, 29, 31, 53, 2, 61, 37, 42, 76, 32, 39,
                0, 25, 11, 5, 33, 54, 70, 1, 72, 59, 15, 30, 10, 78, 79, 38, 40, 46, 74, 82, 50,
                75, 26, 80, 9,
            ];
            let uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                59, 23, 32, 37, 43, 1, 56, 65, 46, 61, 34, 20, 58, 67, 40, 42, 21, 36, 11, 6, 0,
                29, 13, 82, 75, 76, 30, 57, 81, 73, 24, 68, 79, 18, 51, 74, 10, 12, 15, 71, 38, 7,
                72, 27, 16, 83, 44, 48, 33, 25, 50, 63, 39, 5, 4, 53, 17, 2, 86, 26, 8, 9, 80, 31,
                19, 77, 47, 35, 70, 87, 45, 54, 78, 28, 22, 66, 60, 85, 69, 62, 49, 14, 52, 84, 55,
                3, 41, 64,
            ];
            tests(initialize_order, uninitialize_order);
        }

        #[test]
        fn random_random_two() {
            // generated random order
            let initialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                31, 58, 79, 60, 29, 3, 0, 85, 8, 38, 71, 19, 82, 69, 86, 28, 49, 37, 2, 44, 23, 21,
                10, 73, 18, 32, 76, 41, 42, 67, 63, 64, 78, 9, 45, 16, 35, 26, 46, 13, 59, 40, 74,
                51, 81, 53, 84, 25, 57, 34, 65, 56, 17, 5, 48, 39, 4, 36, 54, 87, 72, 66, 62, 77,
                83, 24, 52, 50, 14, 47, 27, 15, 6, 55, 11, 80, 20, 68, 30, 7, 43, 75, 61, 33, 70,
                1, 22, 12,
            ];
            let uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                9, 41, 33, 39, 31, 54, 24, 82, 42, 19, 20, 30, 21, 2, 49, 72, 80, 14, 62, 7, 44,
                84, 46, 48, 58, 50, 71, 76, 35, 0, 43, 1, 22, 51, 29, 64, 75, 10, 61, 53, 6, 47,
                87, 40, 81, 65, 36, 4, 38, 85, 59, 66, 83, 86, 52, 70, 69, 16, 78, 18, 34, 8, 5,
                27, 63, 13, 37, 68, 57, 23, 32, 25, 28, 56, 26, 15, 55, 67, 3, 77, 79, 73, 45, 17,
                60, 11, 12, 74,
            ];
            tests(initialize_order, uninitialize_order);
        }
    }
}
