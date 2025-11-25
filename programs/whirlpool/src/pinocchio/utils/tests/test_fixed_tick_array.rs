use crate::pinocchio::{constants::address::WHIRLPOOL_PROGRAM_ID, state::whirlpool::{MemoryMappedTick, loader::LoadedTickArrayMut}, utils::tests::test_account_info::TestAccountInfo};
use anchor_lang::Discriminator;
use pinocchio::pubkey::Pubkey;

pub struct TestMemoryMappedFixedTickArray {
    test_account_info: TestAccountInfo,
}

impl TestMemoryMappedFixedTickArray {
    pub fn new(start_tick_index: i32, initialized_offsets: Vec<usize>) -> Self {
        let mut test_account_info = TestAccountInfo::new(crate::state::FixedTickArray::LEN)
            .writable()
            .owner(&WHIRLPOOL_PROGRAM_ID);

        let data = test_account_info.data_mut();
        data[0..8].copy_from_slice(crate::state::FixedTickArray::DISCRIMINATOR);
        data[8..8 + 4].copy_from_slice(&start_tick_index.to_le_bytes());
        for offset in initialized_offsets {
            let tick_offset = 12 + offset * core::mem::size_of::<MemoryMappedTick>();
            data[tick_offset] = 1; // initialized
        }
        
        Self { test_account_info }
    }

    pub fn borrow_mut(&self) -> LoadedTickArrayMut {
        crate::pinocchio::state::whirlpool::tick_array::loader::load_tick_array_mut(&self.test_account_info.account_info, &Pubkey::default()).unwrap()
    }
}
