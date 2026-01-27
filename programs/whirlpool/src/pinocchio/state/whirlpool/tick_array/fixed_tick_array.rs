use super::super::super::{BytesI32, Pubkey};
use super::{tick::MemoryMappedTick, TickArray, TickUpdate, TICK_ARRAY_SIZE_USIZE};
use crate::pinocchio::Result;

#[repr(C)]
pub struct MemoryMappedFixedTickArray {
    discriminator: [u8; 8],

    start_tick_index: BytesI32,
    ticks: [MemoryMappedTick; TICK_ARRAY_SIZE_USIZE],
    whirlpool: Pubkey,
}

impl TickArray for MemoryMappedFixedTickArray {
    fn is_variable_size(&self) -> bool {
        false
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

        Ok(&self.ticks[tick_offset])
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

        self.ticks[tick_offset].update(update);

        Ok(())
    }
}
