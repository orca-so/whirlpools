use crate::manager::tick_array_manager::{
    get_tick_rent_amount, TickArrayRentTransfer, TickArraySizeUpdate, TickArrayUpdate,
};
use crate::pinocchio::{errors::WhirlpoolErrorCode, Result};
use pinocchio::account_info::AccountInfo;

pub fn pino_update_tick_array_accounts(
    position_info: &AccountInfo,
    lower_tick_array_info: &AccountInfo,
    upper_tick_array_info: &AccountInfo,
    lower_tick_array_update: &TickArrayUpdate,
    upper_tick_array_update: &TickArrayUpdate,
) -> Result<()> {
    let tick_rent_amount = get_tick_rent_amount()?;

    pino_tick_array_rent_transfer_execute(
        &lower_tick_array_update.transfer_rent,
        position_info,
        lower_tick_array_info,
        tick_rent_amount,
    )?;
    pino_tick_array_rent_transfer_execute(
        &upper_tick_array_update.transfer_rent,
        position_info,
        upper_tick_array_info,
        tick_rent_amount,
    )?;

    pino_tick_array_size_update_execute(
        &lower_tick_array_update.size_update,
        lower_tick_array_info,
    )?;
    pino_tick_array_size_update_execute(
        &upper_tick_array_update.size_update,
        upper_tick_array_info,
    )?;

    // Verify that the tick arrays are rent-exempt
    //verify_rent_exempt(&position_account)?;
    //verify_rent_exempt(&lower_tick_array)?;
    //verify_rent_exempt(&upper_tick_array)?;

    Ok(())
}

fn pino_tick_array_rent_transfer_execute(
    rent_transfer: &TickArrayRentTransfer,
    position_info: &AccountInfo,
    tick_array_info: &AccountInfo,
    tick_rent_amount: u64,
) -> Result<()> {
    match rent_transfer {
        TickArrayRentTransfer::TransferToTickArray => {
            pino_transfer_rent_to_tick_array(tick_array_info, position_info, tick_rent_amount)
        }
        TickArrayRentTransfer::TransferToPosition => {
            pino_transfer_rent_to_position(tick_array_info, position_info, tick_rent_amount)
        }
        TickArrayRentTransfer::None => Ok(()),
    }
}

fn pino_transfer_rent_to_tick_array(
    tick_array_info: &AccountInfo,
    position_info: &AccountInfo,
    amount: u64,
) -> Result<()> {
    let mut position_lamports = position_info.try_borrow_mut_lamports()?;
    let mut tick_array_lamports = tick_array_info.try_borrow_mut_lamports()?;
    *position_lamports = position_lamports
        .checked_sub(amount)
        .ok_or(WhirlpoolErrorCode::RentCalculationError)?;
    *tick_array_lamports = tick_array_lamports
        .checked_add(amount)
        .ok_or(WhirlpoolErrorCode::RentCalculationError)?;
    Ok(())
}

fn pino_transfer_rent_to_position(
    tick_array_info: &AccountInfo,
    position_info: &AccountInfo,
    amount: u64,
) -> Result<()> {
    let mut position_lamports = position_info.try_borrow_mut_lamports()?;
    let mut tick_array_lamports = tick_array_info.try_borrow_mut_lamports()?;
    *position_lamports = position_lamports
        .checked_add(amount)
        .ok_or(WhirlpoolErrorCode::RentCalculationError)?;
    *tick_array_lamports = tick_array_lamports
        .checked_sub(amount)
        .ok_or(WhirlpoolErrorCode::RentCalculationError)?;
    Ok(())
}

fn pino_tick_array_size_update_execute(
    size_update: &TickArraySizeUpdate,
    tick_array_info: &AccountInfo,
) -> Result<()> {
    match size_update {
        TickArraySizeUpdate::Increase => pino_increase_tick_array_size(tick_array_info),
        TickArraySizeUpdate::Decrease => pino_decrease_tick_array_size(tick_array_info),
        TickArraySizeUpdate::None => Ok(()),
    }
}

const TICK_INITIALIZATION_SIZE: usize =
    crate::state::DynamicTick::INITIALIZED_LEN - crate::state::DynamicTick::UNINITIALIZED_LEN;

fn pino_increase_tick_array_size(tick_array_info: &AccountInfo) -> Result<()> {
    let required_size = tick_array_info.data_len() + TICK_INITIALIZATION_SIZE;
    tick_array_info.realloc(required_size, true)?;
    Ok(())
}

fn pino_decrease_tick_array_size(tick_array_info: &AccountInfo) -> Result<()> {
    let required_size = tick_array_info.data_len() - TICK_INITIALIZATION_SIZE;
    tick_array_info.realloc(required_size, true)?;
    Ok(())
}
