#![allow(dead_code)]

use pinocchio::{account_info::AccountInfo, pubkey::Pubkey};

pub struct TestAccountInfo {
    pub account_info: AccountInfo,
    bytes: Vec<u8>,
}

const ACCOUNT_HEADER_SIZE: usize = 88;

const BORROW_STATE_OFFSET: usize = 0;
const IS_SIGNER_OFFSET: usize = 1;
const IS_WRITABLE_OFFSET: usize = 2;
const EXECUTABLE_OFFSET: usize = 3;
const RESIZE_DELTA_OFFSET: usize = 4;
const KEY_OFFSET: usize = 8;
const OWNER_OFFSET: usize = 40;
const LAMPORTS_OFFSET: usize = 72;
const DATA_LEN_OFFSET: usize = 80;
const DATA_OFFSET: usize = 88;

impl TestAccountInfo {
    pub fn new(data_len: usize) -> Self {
        let mut bytes = vec![0u8; ACCOUNT_HEADER_SIZE + data_len];

        bytes[BORROW_STATE_OFFSET] = 0b11111111; // not borrowed

        let data_len_bytes = (data_len as u64).to_le_bytes();
        bytes[DATA_LEN_OFFSET..DATA_LEN_OFFSET + 8].copy_from_slice(&data_len_bytes);

        // HACK: transmute a pointer to the byte array into an AccountInfo
        let account_info = unsafe { std::mem::transmute::<*const u8, AccountInfo>(bytes.as_ptr()) };

        Self {
            bytes,
            account_info,
        }
    }

    pub fn signer(mut self) -> Self {
        self.bytes[IS_SIGNER_OFFSET] = 1;
        self
    }

    pub fn writable(mut self) -> Self {
        self.bytes[IS_WRITABLE_OFFSET] = 1;
        self
    }

    pub fn key(mut self, key: &Pubkey) -> Self {
        self.bytes[KEY_OFFSET..KEY_OFFSET + 32].copy_from_slice(key.as_slice());
        self
    }

    pub fn owner(mut self, owner: &Pubkey) -> Self {
        self.bytes[OWNER_OFFSET..OWNER_OFFSET + 32].copy_from_slice(owner.as_slice());
        self
    }

    pub fn lamports(mut self, lamports: u64) -> Self {
        let lamports_bytes = lamports.to_le_bytes();
        self.bytes[LAMPORTS_OFFSET..LAMPORTS_OFFSET + 8].copy_from_slice(&lamports_bytes);
        self
    }

    pub fn data_mut(&mut self) -> &mut [u8] {
        &mut self.bytes[DATA_OFFSET..]
    }
}

impl TestAccountInfo {
    pub fn new_fixed_tick_array(whirlpool_key: &Pubkey, start_tick_index: i32) -> Self {
        use anchor_lang::Discriminator;

        let mut test_account_info = TestAccountInfo::new(crate::state::FixedTickArray::LEN)
            .owner(&crate::pinocchio::constants::address::WHIRLPOOL_PROGRAM_ID);

        let data = test_account_info.data_mut();
        data[0..8].copy_from_slice(crate::state::FixedTickArray::DISCRIMINATOR);
        data[8..8 + 4].copy_from_slice(&start_tick_index.to_le_bytes());
        data[9956..9956 + 32].copy_from_slice(whirlpool_key.as_slice());

        test_account_info
    }
}
