use super::{
    dynamic_tick_array::MemoryMappedDynamicTickArray, fixed_tick_array::MemoryMappedFixedTickArray,
    TickArray,
};
use crate::pinocchio::{
    Result, constants::address::WHIRLPOOL_PROGRAM_ID, errors::{AnchorErrorCode, WhirlpoolErrorCode}
};
use anchor_lang::Discriminator;
use pinocchio::account_info::{AccountInfo, Ref, RefMut};
use pinocchio::pubkey::Pubkey;
use std::ops::{Deref, DerefMut};

pub type LoadedTickArray<'a> = Ref<'a, dyn TickArray + 'a>;

pub fn load_tick_array<'a>(
    account: &'a AccountInfo,
    whirlpool: &Pubkey,
) -> Result<LoadedTickArray<'a>> {
    if !account.is_owned_by(&WHIRLPOOL_PROGRAM_ID) {
        return Err(AnchorErrorCode::AccountOwnedByWrongProgram.into());
    }

    let data = account.try_borrow_data()?;

    if data.len() < 8 {
        return Err(AnchorErrorCode::AccountDiscriminatorNotFound.into());
    }

    let discriminator = data[0..8].as_ref();
    let tick_array: LoadedTickArray<'a> = match discriminator {
        crate::state::FixedTickArray::DISCRIMINATOR => Ref::map(data, |data| {
            let tick_array = unsafe { &*(data.as_ptr() as *const MemoryMappedFixedTickArray) };
            tick_array as &dyn TickArray
        }),
        crate::state::DynamicTickArray::DISCRIMINATOR => Ref::map(data, |data| {
            let tick_array = unsafe { &*(data.as_ptr() as *const MemoryMappedDynamicTickArray) };
            tick_array as &dyn TickArray
        }),
        _ => return Err(AnchorErrorCode::AccountDiscriminatorMismatch.into()),
    };

    if tick_array.whirlpool() != whirlpool {
        return Err(WhirlpoolErrorCode::DifferentWhirlpoolTickArrayAccount.into());
    }

    Ok(tick_array)
}

pub type LoadedTickArrayMut<'a> = RefMut<'a, dyn TickArray>;

pub fn load_tick_array_mut<'a>(
    account: &'a AccountInfo,
    whirlpool: &Pubkey,
) -> Result<LoadedTickArrayMut<'a>> {
    if !account.is_writable() {
        return Err(AnchorErrorCode::AccountNotMutable.into());
    }

    if !account.is_owned_by(&WHIRLPOOL_PROGRAM_ID) {
        return Err(AnchorErrorCode::AccountOwnedByWrongProgram.into());
    }

    let data = account.try_borrow_mut_data()?;

    if data.len() < 8 {
        return Err(AnchorErrorCode::AccountDiscriminatorNotFound.into());
    }

    let discriminator = data[0..8].as_ref();
    let tick_array: LoadedTickArrayMut<'a> = match discriminator {
        crate::state::FixedTickArray::DISCRIMINATOR => RefMut::map(data, |data| {
            let tick_array =
                unsafe { &mut *(data.as_mut_ptr() as *mut MemoryMappedFixedTickArray) };
            tick_array as &mut dyn TickArray
        }),
        crate::state::DynamicTickArray::DISCRIMINATOR => RefMut::map(data, |data| {
            let tick_array =
                unsafe { &mut *(data.as_mut_ptr() as *mut MemoryMappedDynamicTickArray) };
            tick_array as &mut dyn TickArray
        }),
        _ => return Err(AnchorErrorCode::AccountDiscriminatorMismatch.into()),
    };

    if tick_array.whirlpool() != whirlpool {
        return Err(WhirlpoolErrorCode::DifferentWhirlpoolTickArrayAccount.into());
    }

    Ok(tick_array)
}

/// In increase and decrease liquidity, we directly load the tick arrays mutably.
/// Lower and upper ticker arrays might refer to the same account. We cannot load
/// the same account mutably twice so we just return None if the accounts are the same.
pub struct TickArraysMut<'a> {
    lower_tick_array_ref: LoadedTickArrayMut<'a>,
    upper_tick_array_ref: Option<LoadedTickArrayMut<'a>>,
}

impl<'a> TickArraysMut<'a> {
    pub fn load(
        lower_tick_array_info: &'a AccountInfo,
        upper_tick_array_info: &'a AccountInfo,
        whirlpool: &Pubkey,
    ) -> Result<Self> {
        let lower_tick_array = load_tick_array_mut(lower_tick_array_info, whirlpool)?;
        let upper_tick_array = if lower_tick_array_info.key() == upper_tick_array_info.key() {
            None
        } else {
            Some(load_tick_array_mut(upper_tick_array_info, whirlpool)?)
        };
        Ok(Self {
            lower_tick_array_ref: lower_tick_array,
            upper_tick_array_ref: upper_tick_array,
        })
    }

    pub fn deref(&self) -> (&dyn TickArray, &dyn TickArray) {
        if let Some(upper_tick_array_ref) = &self.upper_tick_array_ref {
            (
                self.lower_tick_array_ref.deref(),
                upper_tick_array_ref.deref(),
            )
        } else {
            (
                self.lower_tick_array_ref.deref(),
                self.lower_tick_array_ref.deref(),
            )
        }
    }

    // Since we can only borrow mutably once, we return None if the upper tick array
    // is the same as the lower tick array
    pub fn deref_mut(&mut self) -> (&mut dyn TickArray, Option<&mut dyn TickArray>) {
        if let Some(upper_tick_array_ref) = &mut self.upper_tick_array_ref {
            (
                self.lower_tick_array_ref.deref_mut(),
                Some(upper_tick_array_ref.deref_mut()),
            )
        } else {
            (self.lower_tick_array_ref.deref_mut(), None)
        }
    }
}
