use super::super::super::{BytesI32, BytesU128, Pubkey};
use super::{tick::MemoryMappedTick, TickArray, TickUpdate, TICK_ARRAY_SIZE_USIZE};
use crate::pinocchio::state::whirlpool::TICK_ARRAY_SIZE;
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

    fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>> {
        if !self.in_search_range(tick_index, tick_spacing, !a_to_b) {
            return Err(crate::errors::ErrorCode::InvalidTickArraySequence.into());
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

        let tick_bitmap = self.tick_bitmap();
        while (0..TICK_ARRAY_SIZE).contains(&curr_offset) {
            let initialized = Self::is_initialized_tick(&tick_bitmap, curr_offset as isize);
            if initialized {
                return Ok(Some(
                    (curr_offset * tick_spacing as i32) + self.start_tick_index(),
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
            let shift_data = &mut self.ticks[byte_offset..];
            shift_data.rotate_right(crate::state::DynamicTickData::LEN);

            // sync bitmap
            self.update_tick_bitmap(tick_offset, true);
        }

        // If the tick needs to be uninitialized, we need to left-shift everything after byte_offset by DynamicTickData::LEN
        if tick_initialized && !update.initialized {
            let shift_data = &mut self.ticks[byte_offset..];
            shift_data.rotate_left(crate::state::DynamicTickData::LEN);

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

    fn update_tick_bitmap(&mut self, tick_offset: usize, initialized: bool) {
        let mut tick_bitmap = self.tick_bitmap();
        if initialized {
            tick_bitmap |= 1 << tick_offset;
        } else {
            tick_bitmap &= !(1 << tick_offset);
        }
        self.tick_bitmap = tick_bitmap.to_le_bytes();
    }

    #[inline(always)]
    fn is_initialized_tick(tick_bitmap: &u128, tick_offset: isize) -> bool {
        (*tick_bitmap & (1 << tick_offset)) != 0
    }
}
