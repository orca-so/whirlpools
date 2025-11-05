pub mod account;
pub mod extensions;
pub mod mint;

pub use account::MemoryMappedTokenAccount;
pub use mint::MemoryMappedTokenMint;
use pinocchio::account_info::Ref;

pub static ZERO_EXTENSIONS_TLV_DATA: [u8; 0] = [];

pub struct TokenProgramAccountWithExtensions<'a, T> {
    bytes: Ref<'a, [u8]>,
    is_token_2022: bool,
    phantom: core::marker::PhantomData<T>,
}

impl<'a, T> TokenProgramAccountWithExtensions<'a, T> {
    pub fn new(bytes: Ref<'a, [u8]>, is_token_2022: bool) -> Self {
        Self {
            bytes,
            is_token_2022,
            phantom: core::marker::PhantomData,
        }
    }
}

impl<'a, T> core::ops::Deref for TokenProgramAccountWithExtensions<'a, T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &Self::Target {
        unsafe { &*(self.bytes.as_ptr() as *const T) }
    }
}

impl<'a, T> TokenProgramAccountWithExtensions<'a, T> {
    #[inline(always)]
    pub fn is_token_2022(&self) -> bool {
        self.is_token_2022
    }

    #[inline(always)]
    pub fn extensions_tlv_data(&self) -> &[u8] {
        const EXTENSIONS_TLV_DATA_OFFSET: usize = 166;

        let data_len = self.bytes.len();
        if data_len <= EXTENSIONS_TLV_DATA_OFFSET {
            &ZERO_EXTENSIONS_TLV_DATA
        } else {
            &self.bytes[EXTENSIONS_TLV_DATA_OFFSET..]
        }
    }
}
