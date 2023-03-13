use anchor_lang::{
    prelude::{AccountInfo, Pubkey, Signer, *},
    ToAccountInfo,
};
use anchor_spl::token::TokenAccount;
use solana_program::program_option::COption;
use std::convert::TryFrom;

use crate::errors::ErrorCode;

pub fn verify_position_bundle_authority<'info>(
    position_bundle_token_account: &TokenAccount,
    position_bundle_authority: &Signer<'info>,
) -> Result<()> {
    // use same logic
    verify_position_authority(
        position_bundle_token_account,
        position_bundle_authority,
    )
}

pub fn verify_position_authority<'info>(
    position_token_account: &TokenAccount,
    position_authority: &Signer<'info>,
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
