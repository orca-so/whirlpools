use super::super::super::Pubkey;
use super::{tick::MemoryMappedTick, TickArray, TickUpdate};
use crate::pinocchio::Result;

#[repr(C)]
pub struct MemoryMappedZeroedTickArray {
    start_tick_index: i32,
}

impl MemoryMappedZeroedTickArray {
    pub fn new(start_tick_index: i32) -> Self {
        MemoryMappedZeroedTickArray { start_tick_index }
    }
}

impl TickArray for MemoryMappedZeroedTickArray {
    fn is_variable_size(&self) -> bool {
        false
    }

    fn start_tick_index(&self) -> i32 {
        self.start_tick_index
    }

    fn whirlpool(&self) -> &Pubkey {
        // Never actually used
        unreachable!()
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

        self.tick_offset(tick_index, tick_spacing)?;

        // no initialized tick
        Ok(None)
    }

    fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<&MemoryMappedTick> {
        match self.check_is_usable_tick_and_get_offset(tick_index, tick_spacing) {
            // always return the zeroed tick
            Some(_offset) => Ok(&super::tick::STATIC_ZEROED_MEMORY_MAPPED_TICK),
            None => Err(crate::errors::ErrorCode::TickNotFound.into()),
        }
    }

    fn update_tick(
        &mut self,
        _tick_index: i32,
        _tick_spacing: u16,
        _update: &TickUpdate,
    ) -> Result<()> {
        panic!("ZeroedTickArray must not be updated");
    }
}
