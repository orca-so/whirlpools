use crate::pinocchio::{
    state::whirlpool::{
        loader::LoadedTickArrayMut, zeroed_tick_array::MemoryMappedZeroedTickArray,
        MemoryMappedTick, TickArray, TickUpdate,
    },
    Result,
};

pub enum ProxiedTickArray<'a> {
    Initialized(LoadedTickArrayMut<'a>),
    Uninitialized(MemoryMappedZeroedTickArray),
}

impl<'a> ProxiedTickArray<'a> {
    pub fn new_initialized(refmut: LoadedTickArrayMut<'a>) -> Self {
        ProxiedTickArray::Initialized(refmut)
    }

    pub fn new_uninitialized(start_tick_index: i32) -> Self {
        ProxiedTickArray::Uninitialized(MemoryMappedZeroedTickArray::new(start_tick_index))
    }

    pub fn start_tick_index(&self) -> i32 {
        self.as_ref().start_tick_index()
    }

    pub fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>> {
        self.as_ref()
            .get_next_init_tick_index(tick_index, tick_spacing, a_to_b)
    }

    pub fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<&MemoryMappedTick> {
        self.as_ref().get_tick(tick_index, tick_spacing)
    }

    pub fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()> {
        self.as_mut().update_tick(tick_index, tick_spacing, update)
    }

    pub fn is_min_tick_array(&self) -> bool {
        self.as_ref().is_min_tick_array()
    }

    pub fn is_max_tick_array(&self, tick_spacing: u16) -> bool {
        self.as_ref().is_max_tick_array(tick_spacing)
    }

    pub fn tick_offset(&self, tick_index: i32, tick_spacing: u16) -> Result<isize> {
        self.as_ref().tick_offset(tick_index, tick_spacing)
    }
}

impl<'a> AsRef<dyn TickArray + 'a> for ProxiedTickArray<'a> {
    fn as_ref(&self) -> &(dyn TickArray + 'a) {
        match self {
            ProxiedTickArray::Initialized(ref array) => &**array,
            ProxiedTickArray::Uninitialized(ref array) => array,
        }
    }
}

impl<'a> AsMut<dyn TickArray + 'a> for ProxiedTickArray<'a> {
    fn as_mut(&mut self) -> &mut (dyn TickArray + 'a) {
        match self {
            ProxiedTickArray::Initialized(ref mut array) => &mut **array,
            ProxiedTickArray::Uninitialized(ref mut array) => array,
        }
    }
}
