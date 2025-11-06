use crate::pinocchio::{
    errors::WhirlpoolErrorCode, state::token::MemoryMappedTokenAccount, Result,
};
use pinocchio::account_info::AccountInfo;
use pinocchio::pubkey::Pubkey;

pub fn pino_verify_position_authority(
    // position_token_account is owned by either TokenProgram or Token2022Program
    position_token_account: &MemoryMappedTokenAccount,
    position_authority_info: &AccountInfo,
) -> Result<()> {
    // Check token authority using validate_owner method...
    match position_token_account.delegate() {
        Option::Some(delegate) if position_authority_info.key() == delegate => {
            pino_validate_owner(delegate, position_authority_info)?;
            if position_token_account.delegated_amount() != 1 {
                return Err(WhirlpoolErrorCode::InvalidPositionTokenAmount.into());
            }
        }
        _ => pino_validate_owner(position_token_account.owner(), position_authority_info)?,
    };
    Ok(())
}

fn pino_validate_owner(expected_owner: &Pubkey, owner_account_info: &AccountInfo) -> Result<()> {
    if expected_owner != owner_account_info.key() || !owner_account_info.is_signer() {
        return Err(WhirlpoolErrorCode::MissingOrInvalidDelegate.into());
    }

    Ok(())
}

pub fn pino_is_locked_position(
    position_token_account: &MemoryMappedTokenAccount,
) -> bool {
    position_token_account.is_frozen()
}
