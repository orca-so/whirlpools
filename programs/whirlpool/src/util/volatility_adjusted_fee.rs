use anchor_lang::prelude::*;
use crate::{manager::fee_rate_manager::AdaptiveFeeInfo, state::Oracle};
use std::cell::{Ref, RefMut};

pub fn load_adaptive_fee_info<'info>(
  oracle: &UncheckedAccount<'info>,
) -> Result<Option<AdaptiveFeeInfo>> {
    use anchor_lang::Discriminator;

    let account_info = oracle.to_account_info();

    // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
    // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
    // So we need to handle uninitialized account manually.

    // account must be writable
    if !account_info.is_writable {
        return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
    }

    // uninitialized writable account (owned by system program and its data size is zero)
    if account_info.owner == &System::id() && account_info.data_is_empty() {
      // oracle is not initialized
        return Ok(None);
    }

    // owner program check
    if account_info.owner != &Oracle::owner() {
        return Err(
            Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                .with_pubkeys((*account_info.owner, Oracle::owner())),
        );
    }

    let data = account_info.try_borrow_data()?;
    if data.len() < Oracle::discriminator().len() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let disc_bytes = arrayref::array_ref![data, 0, 8];
    if disc_bytes != &Oracle::discriminator() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }

    let oracle: Ref<Oracle> = Ref::map(data, |data| {
        bytemuck::from_bytes(&data[8..std::mem::size_of::<Oracle>() + 8])
    });

    Ok(Some(AdaptiveFeeInfo {
        constants: oracle.adaptive_fee_constants,
        variables: oracle.adaptive_fee_variables,
    }))
}

pub fn update_adaptive_fee_info<'info>(
  oracle: &UncheckedAccount<'info>,
  adaptive_fee_info: &AdaptiveFeeInfo,
) -> Result<()> {
    use anchor_lang::Discriminator;

    let account_info = oracle.to_account_info();

    // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
    // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
    // So we need to handle uninitialized account manually.

    // TODO: remove duplicated check

    // account must be writable
    if !account_info.is_writable {
        return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
    }

    // uninitialized writable account (owned by system program and its data size is zero)
    if account_info.owner == &System::id() && account_info.data_is_empty() {
      // oracle is not initialized
        return Err(anchor_lang::error::ErrorCode::AccountNotInitialized.into());
    }

    // owner program check
    if account_info.owner != &Oracle::owner() {
        return Err(
            Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                .with_pubkeys((*account_info.owner, Oracle::owner())),
        );
    }

    let data = account_info.try_borrow_mut_data()?;
    if data.len() < Oracle::discriminator().len() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let disc_bytes = arrayref::array_ref![data, 0, 8];
    if disc_bytes != &Oracle::discriminator() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }

    let mut oracle: RefMut<Oracle> = RefMut::map(data, |data| {
        bytemuck::from_bytes_mut(&mut data[8..std::mem::size_of::<Oracle>() + 8])
    });

    // TODO: separate constants update and variables update for safety
    // oracle.va_fee_constants = va_fee_info.constants;
    oracle.adaptive_fee_variables = adaptive_fee_info.variables;

    Ok(())
}
