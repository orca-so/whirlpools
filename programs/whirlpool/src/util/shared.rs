use anchor_lang::{
    prelude::{AccountInfo, Pubkey, Signer, *},
    ToAccountInfo,
};
use anchor_spl::token::TokenAccount;
use anchor_spl::token_interface::TokenAccount as TokenAccountInterface;
use solana_program::program_option::COption;
use std::convert::TryFrom;

use crate::errors::ErrorCode;

pub fn verify_position_bundle_authority(
    position_bundle_token_account: &TokenAccount,
    position_bundle_authority: &Signer<'_>,
) -> Result<()> {
    // use same logic
    verify_position_authority(position_bundle_token_account, position_bundle_authority)
}

pub fn verify_position_authority(
    position_token_account: &TokenAccount,
    position_authority: &Signer<'_>,
) -> Result<()> {
    // Check token authority using validate_owner method...
    match position_token_account.delegate {
        COption::Some(ref delegate) if position_authority.key == delegate => {
            validate_owner(delegate, &position_authority.to_account_info())?;
            if position_token_account.delegated_amount != 1 {
                return Err(ErrorCode::InvalidPositionTokenAmount.into());
            }
        }
        _ => validate_owner(
            &position_token_account.owner,
            &position_authority.to_account_info(),
        )?,
    };
    Ok(())
}

pub fn verify_position_authority_interface(
    // position_token_account is owned by either TokenProgram or Token2022Program
    position_token_account: &InterfaceAccount<'_, TokenAccountInterface>,
    position_authority: &Signer<'_>,
) -> Result<()> {
    // Check token authority using validate_owner method...
    match position_token_account.delegate {
        COption::Some(ref delegate) if position_authority.key == delegate => {
            validate_owner(delegate, &position_authority.to_account_info())?;
            if position_token_account.delegated_amount != 1 {
                return Err(ErrorCode::InvalidPositionTokenAmount.into());
            }
        }
        _ => validate_owner(
            &position_token_account.owner,
            &position_authority.to_account_info(),
        )?,
    };
    Ok(())
}

fn validate_owner(expected_owner: &Pubkey, owner_account_info: &AccountInfo) -> Result<()> {
    if expected_owner != owner_account_info.key || !owner_account_info.is_signer {
        return Err(ErrorCode::MissingOrInvalidDelegate.into());
    }

    Ok(())
}

pub fn to_timestamp_u64(t: i64) -> Result<u64> {
    u64::try_from(t).or(Err(ErrorCode::InvalidTimestampConversion.into()))
}

pub fn is_locked_position(
    position_token_account: &InterfaceAccount<'_, TokenAccountInterface>,
) -> bool {
    position_token_account.is_frozen()
}
