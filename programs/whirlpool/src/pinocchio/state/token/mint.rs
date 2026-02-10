use crate::pinocchio::state::TokenProgramAccount;

use super::super::{BytesU64, COption, Pubkey};

#[repr(C)]
pub struct MemoryMappedTokenMint {
    mint_authority: COption<Pubkey>,
    supply: BytesU64,
    decimals: u8,
    is_initialized: u8,
    freeze_authority: COption<Pubkey>,
}

impl MemoryMappedTokenMint {
    #[inline(always)]
    pub fn decimals(&self) -> u8 {
        self.decimals
    }
}

impl TokenProgramAccount for MemoryMappedTokenMint {
    const BASE_STATE_LEN: usize = 82;
    const IS_INITIALIZED_OFFSET: usize = 45;
    const ACCOUNT_TYPE: u8 = 0x01;
}
