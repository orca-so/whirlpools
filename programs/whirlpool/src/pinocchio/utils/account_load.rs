use crate::pinocchio::errors::AnchorErrorCode;
use crate::pinocchio::{
    constants::address::{TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WHIRLPOOL_PROGRAM_ID},
    state::{
        token::TokenProgramAccountWithExtensions, TokenProgramAccount, WhirlpoolProgramAccount,
    },
    Result,
};
use arrayref::array_ref;
use pinocchio::{
    account_info::{AccountInfo, Ref, RefMut},
    pubkey::Pubkey,
};

#[inline(always)]
fn check_owner_program(account_info: &AccountInfo, program_id: &Pubkey) -> Result<()> {
    if !account_info.is_owned_by(program_id) {
        return Err(AnchorErrorCode::AccountOwnedByWrongProgram.into());
    }
    Ok(())
}

#[inline(always)]
fn check_discriminator(account_info: &AccountInfo, discriminator: &[u8; 8]) -> Result<()> {
    let bytes = account_info.try_borrow_data()?;
    if bytes.len() < 8 {
        return Err(AnchorErrorCode::AccountDiscriminatorNotFound.into());
    }
    if array_ref![bytes, 0, 8] != discriminator {
        return Err(AnchorErrorCode::AccountDiscriminatorMismatch.into());
    }
    Ok(())
}

pub fn load_account_mut<T: WhirlpoolProgramAccount>(
    account_info: &'_ AccountInfo,
) -> Result<RefMut<'_, T>> {
    check_owner_program(account_info, &WHIRLPOOL_PROGRAM_ID)?;
    check_discriminator(account_info, &T::DISCRIMINATOR)?;
    load_account_mut_unchecked(account_info)
}

pub fn load_account_mut_unchecked<T: WhirlpoolProgramAccount>(
    account_info: &'_ AccountInfo,
) -> Result<RefMut<'_, T>> {
    let bytes = account_info.try_borrow_mut_data()?;
    Ok(RefMut::map(bytes, |bytes| unsafe {
        &mut *(bytes.as_mut_ptr() as *mut T)
    }))
}

pub fn load_account<T: WhirlpoolProgramAccount>(
    account_info: &'_ AccountInfo,
) -> Result<Ref<'_, T>> {
    check_owner_program(account_info, &WHIRLPOOL_PROGRAM_ID)?;
    check_discriminator(account_info, &T::DISCRIMINATOR)?;
    load_account_unchecked(account_info)
}

pub fn load_account_unchecked<T: WhirlpoolProgramAccount>(
    account_info: &'_ AccountInfo,
) -> Result<Ref<'_, T>> {
    let bytes = account_info.try_borrow_data()?;
    Ok(Ref::map(bytes, |bytes| unsafe {
        &*(bytes.as_ptr() as *const T)
    }))
}

const ACCOUNT_TYPE_OFFSET: usize = 165;

// Token in hex: 06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9
const LAST_BYTE_OF_TOKEN_PROGRAM_ID: u8 = 0xa9;
// Token-2022 in hex: 06ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfc
const LAST_BYTE_OF_TOKEN_2022_PROGRAM_ID: u8 = 0xfc;

pub fn load_token_program_account<T: TokenProgramAccount>(
    account_info: &'_ AccountInfo,
) -> Result<TokenProgramAccountWithExtensions<T>> {
    let owner_program_id = account_info.owner();
    let is_token_2022 = match owner_program_id[31] {
        LAST_BYTE_OF_TOKEN_PROGRAM_ID => {
            check_owner_program(account_info, &TOKEN_PROGRAM_ID)?;
            false
        }
        LAST_BYTE_OF_TOKEN_2022_PROGRAM_ID => {
            check_owner_program(account_info, &TOKEN_2022_PROGRAM_ID)?;
            true
        }
        _ => return Err(AnchorErrorCode::AccountOwnedByWrongProgram.into()),
    };

    let data_len = account_info.data_len();
    if data_len <= T::IS_INITIALIZED_OFFSET {
        return Err(AnchorErrorCode::AccountNotInitialized.into());
    }

    let bytes = account_info.try_borrow_data()?;
    if bytes[T::IS_INITIALIZED_OFFSET] == 0 {
        return Err(AnchorErrorCode::AccountNotInitialized.into());
    }

    if data_len == T::BASE_STATE_LEN {
        // without TokenExtensions
        return Ok(TokenProgramAccountWithExtensions::new(bytes, is_token_2022));
    }

    if data_len <= ACCOUNT_TYPE_OFFSET || bytes[ACCOUNT_TYPE_OFFSET] != T::ACCOUNT_TYPE {
        return Err(AnchorErrorCode::AccountDiscriminatorMismatch.into());
    }

    // with TokenExtensions
    Ok(TokenProgramAccountWithExtensions::new(bytes, is_token_2022))
}

pub fn load_token_program_account_unchecked<T: TokenProgramAccount>(
    account_info: &'_ AccountInfo,
) -> Result<TokenProgramAccountWithExtensions<T>> {
    let owner_program_id = account_info.owner();
    let is_token_2022 = owner_program_id[31] == LAST_BYTE_OF_TOKEN_2022_PROGRAM_ID;
    let bytes = account_info.try_borrow_data()?;
    Ok(TokenProgramAccountWithExtensions::new(bytes, is_token_2022))
}
