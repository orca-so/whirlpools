use crate::pinocchio::{
    state::whirlpool::{loader::LoadedTickArrayMut, MemoryMappedTick},
    utils::tests::test_account_info::TestAccountInfo,
};
use pinocchio::pubkey::Pubkey;

pub struct TestMemoryMappedFixedTickArray {
    test_account_info: TestAccountInfo,
}

impl TestMemoryMappedFixedTickArray {
    pub fn new(start_tick_index: i32, initialized_offsets: Vec<usize>) -> Self {
        let mut test_account_info =
            TestAccountInfo::new_fixed_tick_array(&Pubkey::default(), start_tick_index).writable();

        let data = test_account_info.data_mut();
        for offset in initialized_offsets {
            let tick_offset = 12 + offset * core::mem::size_of::<MemoryMappedTick>();
            data[tick_offset] = 1; // initialized
        }

        Self { test_account_info }
    }

    pub fn borrow_mut(&self) -> LoadedTickArrayMut {
        crate::pinocchio::state::whirlpool::tick_array::loader::load_tick_array_mut(
            &self.test_account_info.account_info,
            &Pubkey::default(),
        )
        .unwrap()
    }
}
