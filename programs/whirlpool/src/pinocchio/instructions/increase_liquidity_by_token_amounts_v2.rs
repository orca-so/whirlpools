use crate::pinocchio::{errors::WhirlpoolErrorCode, Result};
use pinocchio::account_info::AccountInfo;

pub fn handler(_accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // Decode instruction data to validate discriminator and payload shape.
    use anchor_lang::AnchorDeserialize;
    let _ = crate::instruction::IncreaseLiquidityByTokenAmountsV2::try_from_slice(&data[8..])?;

    // TODO
    Err(WhirlpoolErrorCode::FeatureIsNotEnabled.into())
}
