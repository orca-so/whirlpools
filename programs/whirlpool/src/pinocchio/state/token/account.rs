use crate::pinocchio::state::TokenProgramAccount;

use super::super::{BytesU64, COption, Pubkey};

#[repr(u8)]
pub enum AccountState {
    Uninitialized,
    Initialized,
    Frozen,
}

#[repr(C)]
pub struct MemoryMappedTokenAccount {
    mint: Pubkey,
    owner: Pubkey,
    amount: BytesU64,
    delegate: COption<Pubkey>,
    state: AccountState,
    is_native: COption<BytesU64>,
    delegated_amount: BytesU64,
    close_authority: COption<Pubkey>,
}

impl MemoryMappedTokenAccount {
    #[inline(always)]
    pub fn mint(&self) -> &Pubkey {
        &self.mint
    }

    #[inline(always)]
    pub fn owner(&self) -> &Pubkey {
        &self.owner
    }

    #[inline(always)]
    pub fn amount(&self) -> u64 {
        u64::from_le_bytes(self.amount)
    }

    #[inline(always)]
    pub fn delegate(&self) -> Option<&Pubkey> {
        if self.delegate.0[0] == 1 {
            Some(&self.delegate.1)
        } else {
            None
        }
    }

    #[inline(always)]
    pub fn delegated_amount(&self) -> u64 {
        u64::from_le_bytes(self.delegated_amount)
    }
}

impl TokenProgramAccount for MemoryMappedTokenAccount {
    const BASE_STATE_LEN: usize = 165;
    const IS_INITIALIZED_OFFSET: usize = 108;
    const ACCOUNT_TYPE: u8 = 0x02;
}
