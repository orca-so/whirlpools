use crate::pinocchio::constants::address::{SYSTEM_PROGRAM_ID, WHIRLPOOL_PROGRAM_ID};
use crate::pinocchio::errors::AnchorErrorCode;
use crate::pinocchio::state::whirlpool::oracle::oracle::MemoryMappedOracle;
use crate::pinocchio::Result;
use crate::state::AdaptiveFeeInfo;
use anchor_lang::Discriminator;
use pinocchio::account_info::{AccountInfo, Ref, RefMut};
use pinocchio::pubkey::{pubkey_eq, Pubkey};

pub struct OracleAccessor<'a> {
    oracle_account_info: &'a AccountInfo,
    oracle_account_initialized: bool,
}

impl<'a> OracleAccessor<'a> {
    pub fn new(whirlpool_key: &Pubkey, oracle_account_info: &'a AccountInfo) -> Result<Self> {
        let oracle_account_initialized =
            Self::is_oracle_account_initialized(oracle_account_info, whirlpool_key)?;
        Ok(Self {
            oracle_account_info,
            oracle_account_initialized,
        })
    }

    pub fn is_trade_enabled(&self, current_timestamp: u64) -> Result<bool> {
        if !self.oracle_account_initialized {
            return Ok(true);
        }

        let oracle = self.load()?;
        Ok(oracle.trade_enable_timestamp() <= current_timestamp)
    }

    pub fn get_adaptive_fee_info(&self) -> Result<Option<AdaptiveFeeInfo>> {
        if !self.oracle_account_initialized {
            return Ok(None);
        }

        let oracle = self.load()?;
        Ok(Some(AdaptiveFeeInfo {
            constants: oracle.adaptive_fee_constants(),
            variables: oracle.adaptive_fee_variables(),
        }))
    }

    pub fn update_adaptive_fee_variables(
        &self,
        adaptive_fee_info: &Option<AdaptiveFeeInfo>,
    ) -> Result<()> {
        // If the Oracle account is not initialized, load_mut access will be skipped.
        // In other words, no need for writable flag on the Oracle account if it is not initialized.

        match (self.oracle_account_initialized, adaptive_fee_info) {
            // Oracle account has been initialized and adaptive fee info is provided
            (true, Some(adaptive_fee_info)) => {
                let mut oracle = self.load_mut()?;
                oracle.update_adaptive_fee_variables(&adaptive_fee_info.variables);
                Ok(())
            }
            // Oracle account has not been initialized and adaptive fee info is not provided
            (false, None) => Ok(()),
            _ => unreachable!(),
        }
    }

    fn is_oracle_account_initialized(
        oracle_account_info: &AccountInfo,
        whirlpool_key: &Pubkey,
    ) -> Result<bool> {
        // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
        // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
        // So we need to handle uninitialized account manually.

        // Note: intentionally do not check if the account is writable here, defer the evaluation until load_mut is called

        // uninitialized account (owned by system program and its data size is zero)
        if oracle_account_info.is_owned_by(&SYSTEM_PROGRAM_ID)
            && oracle_account_info.data_is_empty()
        {
            // oracle is not initialized
            return Ok(false);
        }

        // owner program check
        if !oracle_account_info.is_owned_by(&WHIRLPOOL_PROGRAM_ID) {
            return Err(AnchorErrorCode::AccountOwnedByWrongProgram.into());
        }

        let data = oracle_account_info.try_borrow_data()?;
        if data.len() < 8 {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        }

        if &data[..8] != crate::state::Oracle::DISCRIMINATOR {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
        }

        // whirlpool check
        let oracle: Ref<MemoryMappedOracle> = Ref::map(data, |data| unsafe {
            &*(data.as_ptr() as *const MemoryMappedOracle)
        });
        if !pubkey_eq(oracle.whirlpool(), whirlpool_key) {
            // Just for safety: Oracle address is derived from Whirlpool address, so this should not happen.
            unreachable!();
        }

        Ok(true)
    }

    fn load(&self) -> Result<Ref<'_, MemoryMappedOracle>> {
        // is_oracle_account_initialized already checked if the account is initialized

        let data = self.oracle_account_info.try_borrow_data()?;
        let oracle: Ref<MemoryMappedOracle> = Ref::map(data, |data| unsafe {
            &*(data.as_ptr() as *const MemoryMappedOracle)
        });

        Ok(oracle)
    }

    fn load_mut(&self) -> Result<RefMut<'_, MemoryMappedOracle>> {
        // is_oracle_account_initialized already checked if the account is initialized

        // account must be writable
        if !self.oracle_account_info.is_writable() {
            return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
        }

        let data = self.oracle_account_info.try_borrow_mut_data()?;
        let oracle: RefMut<MemoryMappedOracle> = RefMut::map(data, |data| unsafe {
            &mut *(data.as_mut_ptr() as *mut MemoryMappedOracle)
        });

        Ok(oracle)
    }
}
