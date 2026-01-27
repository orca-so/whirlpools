use crate::pinocchio::{errors::AnchorErrorCode, Result};
use pinocchio::pubkey::pubkey_eq;
use pinocchio::pubkey::Pubkey;

pub fn verify_constraint(condition: bool) -> Result<()> {
    if !condition {
        return Err(AnchorErrorCode::ConstraintRaw.into());
    }
    Ok(())
}

pub fn verify_address(address: &Pubkey, expected: &Pubkey) -> Result<()> {
    if !pubkey_eq(address, expected) {
        return Err(AnchorErrorCode::ConstraintAddress.into());
    }
    Ok(())
}
