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
const MULTISIG_ACCOUNT_LEN: usize = 355;

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

    // reject Multisig account
    if data_len == MULTISIG_ACCOUNT_LEN {
        return Err(AnchorErrorCode::AccountDiscriminatorMismatch.into());
    }

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

#[cfg(test)]
mod multisig_account_loading {
    use super::*;
    use crate::pinocchio::{
        constants::address::TOKEN_2022_PROGRAM_ID, state::token::MemoryMappedTokenAccount,
    };
    use anchor_spl::token::spl_token::state::Multisig;
    use pinocchio::account_info::AccountInfo;

    #[test]
    fn test_reject_multisig_account() {
        #[repr(C)]
        pub struct RawAccount {
            borrow_state: u8,
            is_signer: u8,
            is_writable: u8,
            executable: u8,
            resize_delta: i32,
            key: pinocchio::pubkey::Pubkey,
            owner: pinocchio::pubkey::Pubkey,
            lamports: u64,
            data_len: u64,
            data: [u8; 355],
        }
        unsafe fn make_account_info(raw: *mut RawAccount) -> AccountInfo {
            let mut slot = std::mem::MaybeUninit::<AccountInfo>::uninit();
            (slot.as_mut_ptr() as *mut *mut RawAccount).write(raw);
            slot.assume_init()
        }
        use solana_program::program_pack::Pack;
        let full_pubkey = [0xffu8; 32];
        let full_pubkey = anchor_lang::prelude::Pubkey::from(full_pubkey);
        let signers = [
            full_pubkey,                                     // 3 ~ 35
            full_pubkey,                                     // 35 ~ 35 + 32
            full_pubkey,                                     // 67 ~ 67 + 32
            full_pubkey,                                     // 99 ~ 99 + 32
            full_pubkey,                                     // 131 ~ 131 + 32
            anchor_lang::prelude::Pubkey::from([0x2u8; 32]), // 163 ~ 163 + 32 (0x2 is the token account discriminator)
            full_pubkey,                                     // ...
            full_pubkey,
            full_pubkey,
            full_pubkey,
            full_pubkey,
        ];
        let account_data = Multisig {
            m: 0xff,              // 0
            n: 0xff,              // 1
            is_initialized: true, // 2
            signers,
        };
        let mut account_data_slice = [0u8; 355];
        account_data.pack_into_slice(&mut account_data_slice);
        let multisig_account = RawAccount {
            borrow_state: 0b_1111_1111,
            is_signer: 0,
            is_writable: 0,
            executable: 0,
            resize_delta: 0,
            key: [0u8; 32],
            owner: TOKEN_2022_PROGRAM_ID,
            lamports: 0,
            data_len: 355,
            data: account_data_slice,
        };
        let multisig_account_info =
            unsafe { make_account_info(&multisig_account as *const _ as *mut _) };
        let multisig_account =
            load_token_program_account::<MemoryMappedTokenAccount>(&multisig_account_info);

        assert!(multisig_account.is_err());
    }
}
