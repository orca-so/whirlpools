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
/* 
#[cfg(test)]
impl Default for MemoryMappedFixedTickArray{
    fn default() -> Self {
        Self {
            discriminator: [0u8; 8],
            start_tick_index: 0i32.to_le_bytes(),
            ticks: core::array::from_fn(|_| MemoryMappedTick::default()),
            whirlpool: Pubkey::default(),
        }
    }
}

#[cfg(test)]
pub mod tick_array_builder {
    use super::*;

    #[derive(Default)]
    pub struct TickArrayBuilder(MemoryMappedFixedTickArray);

    impl TickArrayBuilder {
        pub fn start_tick_index(mut self, start_tick_index: i32) -> Self {
            self.0.start_tick_index = start_tick_index.to_le_bytes();
            self
        }

        pub fn whirlpool(mut self, whirlpool: Pubkey) -> Self {
            self.0.whirlpool = whirlpool;
            self
        }

        pub fn tick(mut self, tick: MemoryMappedTick, tick_index: i32, tick_spacing: u16) -> Self {
            let offset = self.0.tick_offset(tick_index, tick_spacing).unwrap();
            assert!(offset >= 0);
            self.0.ticks[offset as usize] = tick;
            self
        }

        pub fn tick_with_offset(mut self, tick: MemoryMappedTick, offset: usize) -> Self {
            self.0.ticks[offset] = tick;
            self
        }

        pub fn ticks(mut self, ticks: [MemoryMappedTick; TICK_ARRAY_SIZE_USIZE]) -> Self {
            self.0.ticks = ticks;
            self
        }

        pub fn build(self) -> MemoryMappedFixedTickArray {
            self.0
        }
    }
}
*/