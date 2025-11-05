use crate::pinocchio::{constants::address, errors::AnchorErrorCode, Result};
use pinocchio::account_info::AccountInfo;
use pinocchio::pubkey::Pubkey;
use pinocchio::pubkey::pubkey_eq;

/// Iterator wrapper for sequential account access with validation
pub struct AccountIterator<'a> {
    accounts: &'a [AccountInfo],
    accounts_len: usize,
    current_index: usize,
}

impl<'a> AccountIterator<'a> {
    pub fn new(accounts: &'a [AccountInfo]) -> Self {
        Self {
            accounts,
            accounts_len: accounts.len(),
            current_index: 0,
        }
    }

    /// Get the next account (read-only) - use with method chaining for custom validation
    #[inline(always)]
    pub fn next(&mut self) -> Result<&'a AccountInfo> {
        self.next_account()
    }

    /// Get the next account that must be writable
    #[inline(always)]
    pub fn next_mut(&mut self) -> Result<&'a AccountInfo> {
        let account = self.next_account()?;

        if !account.is_writable() {
            return Err(AnchorErrorCode::AccountNotMutable.into());
        }

        Ok(account)
    }

    /// Get the next account that must be a signer
    #[inline(always)]
    pub fn next_signer(&mut self) -> Result<&'a AccountInfo> {
        if self.current_index >= self.accounts_len {
            return Err(AnchorErrorCode::AccountNotEnoughKeys.into());
        }
        let account = &self.accounts[self.current_index];
        self.current_index += 1;

        if !account.is_signer() {
            return Err(AnchorErrorCode::AccountNotSigner.into());
        }

        Ok(account)
    }

    /// Get the next account that must be both writable and a signer
    #[inline(always)]
    #[allow(dead_code)]
    pub fn next_signer_mut(&mut self) -> Result<&'a AccountInfo> {
        if self.current_index >= self.accounts_len {
            return Err(AnchorErrorCode::AccountNotEnoughKeys.into());
        }
        let account = &self.accounts[self.current_index];
        self.current_index += 1;

        if !account.is_writable() {
            return Err(AnchorErrorCode::AccountNotMutable.into());
        }
        if !account.is_signer() {
            return Err(AnchorErrorCode::AccountNotSigner.into());
        }

        Ok(account)
    }

    /// Get the next account that must be the Memo program
    #[inline(always)]
    pub fn next_program_memo(&mut self) -> Result<&'a AccountInfo> {
        self.next_program_account(&[&address::MEMO_PROGRAM_ID])
    }

    /// Get the next account that must be either the SPL Token program or SPL Token 2022 program
    #[inline(always)]
    pub fn next_program_token_or_token_2022(&mut self) -> Result<&'a AccountInfo> {
        self.next_program_account(&[&address::TOKEN_PROGRAM_ID, &address::TOKEN_2022_PROGRAM_ID])
    }

    /// Get remaining accounts as a slice
    pub fn remaining_accounts(&self) -> &[AccountInfo] {
        &self.accounts[self.current_index..]
    }

    #[inline(always)]
    fn next_account(&mut self) -> Result<&'a AccountInfo> {
        if self.current_index >= self.accounts_len {
            return Err(AnchorErrorCode::AccountNotEnoughKeys.into());
        }
        let account = &self.accounts[self.current_index];
        self.current_index += 1;

        Ok(account)
    }

    #[inline(always)]
    fn next_program_account(&mut self, valid_programs: &[&Pubkey]) -> Result<&'a AccountInfo> {
        let account = self.next_account()?;
        if !valid_programs
            .iter()
            .any(|program_id| pubkey_eq(account.key(), program_id))
        {
            return Err(AnchorErrorCode::ConstraintAddress.into());
        }
        Ok(account)
    }
}
