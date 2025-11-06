use crate::manager::tick_array_manager::get_tick_rent_amount;
use crate::pinocchio::{
    cpi::system_transfer::SystemTransfer,
    errors::{AnchorErrorCode, WhirlpoolErrorCode},
    Result,
};
use crate::state::Position;
use pinocchio::{
    account_info::AccountInfo,
    sysvars::{rent::Rent, Sysvar},
};

pub fn pino_ensure_position_has_enough_rent_for_ticks(
    funder_info: &AccountInfo,
    position_info: &AccountInfo,
    system_program_info: &AccountInfo,
) -> Result<()> {
    if !funder_info.is_signer() {
        return Err(AnchorErrorCode::AccountNotSigner.into());
    }

    let rent = Rent::get()?;
    let position_rent_required = rent.minimum_balance(Position::LEN);
    let tick_rent_amount = get_tick_rent_amount()?;
    let tick_required_rent = tick_rent_amount
        .checked_mul(2)
        .ok_or(WhirlpoolErrorCode::RentCalculationError)?;
    let all_required_rent = position_rent_required
        .checked_add(tick_required_rent)
        .ok_or(WhirlpoolErrorCode::RentCalculationError)?;

    let position_lamports = position_info.lamports();
    if position_lamports < all_required_rent {
        // If the position doesn't have enough rent, we need to transfer more SOL from the funder to the position
        let additional_rent_required = all_required_rent - position_lamports;

        // Safeguard
        if additional_rent_required > tick_required_rent {
            unreachable!(
                "The position account must hold sufficient rent-exempt balance for itself"
            );
        }

        SystemTransfer {
            program: system_program_info,
            from: funder_info,
            to: position_info,
            lamports: additional_rent_required,
        }
        .invoke()?;
    }

    Ok(())
}
