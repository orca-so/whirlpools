use crate::pinocchio::utils::pda::find_program_address;
use crate::pinocchio::{errors::AnchorErrorCode, Result};
use pinocchio::pubkey::pubkey_eq;
use pinocchio::pubkey::Pubkey;

pub fn verify_constraint(condition: bool) -> Result<()> {
    if !condition {
        return Err(AnchorErrorCode::ConstraintRaw.into());
    }
    Ok(())
}

pub fn verify_address(address: &Pubkey, expected_address: &Pubkey) -> Result<()> {
    if !pubkey_eq(address, expected_address) {
        return Err(AnchorErrorCode::ConstraintAddress.into());
    }
    Ok(())
}

pub fn verify_whirlpool_program_address_seeds(
    address: &Pubkey,
    expected_seeds: &[&[u8]],
) -> Result<()> {
    let (expected_address, _bump) = find_program_address(
        expected_seeds,
        &crate::pinocchio::constants::address::WHIRLPOOL_PROGRAM_ID,
    );
    if !pubkey_eq(address, &expected_address) {
        return Err(AnchorErrorCode::ConstraintSeeds.into());
    }
    Ok(())
}
