use anchor_lang::prelude::*;
use solana_program::{program::invoke, system_instruction};

use crate::errors::ErrorCode;
use crate::state::{DynamicTick, Position, PositionUpdate, Tick, TickUpdate};
const TICK_INITIALIZATION_SIZE: usize =
    DynamicTick::INITIALIZED_LEN - DynamicTick::UNINITIALIZED_LEN;

#[derive(Default, Debug, PartialEq)]
pub enum TickArrayRentTransfer {
    #[default]
    None,
    TransferToTickArray,
    TransferToPosition,
}

impl TickArrayRentTransfer {
    fn execute<'info>(
        &self,
        position: &Account<'info, Position>,
        tick_array: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        match self {
            TickArrayRentTransfer::TransferToTickArray => {
                transfer_rent_to_tick_array(tick_array, position, amount)
            }
            TickArrayRentTransfer::TransferToPosition => {
                transfer_rent_to_position(tick_array, position, amount)
            }
            TickArrayRentTransfer::None => Ok(()),
        }
    }
}

#[derive(Default, Debug, PartialEq)]
pub enum TickArraySizeUpdate {
    #[default]
    None,
    Increase,
    Decrease,
}

impl TickArraySizeUpdate {
    fn execute(&self, tick_array: &AccountInfo<'_>) -> Result<()> {
        match self {
            TickArraySizeUpdate::Increase => increase_tick_array_size(tick_array),
            TickArraySizeUpdate::Decrease => decrease_tick_array_size(tick_array),
            TickArraySizeUpdate::None => Ok(()),
        }
    }
}

#[derive(Default, Debug)]
pub struct TickArrayUpdate {
    pub transfer_rent: TickArrayRentTransfer,
    pub size_update: TickArraySizeUpdate,
}

pub fn get_tick_rent_amount() -> Result<u64> {
    let rent = Rent::get()?;
    let amount = ((TICK_INITIALIZATION_SIZE as u64 * rent.lamports_per_byte_year) as f64
        * rent.exemption_threshold)
        .ceil() as u64;
    Ok(amount)
}

pub fn calculate_modify_tick_array(
    position: &Position,
    position_update: &PositionUpdate,
    is_variable_size_tick_array: bool,
    tick: &Tick,
    tick_update: &TickUpdate,
) -> Result<TickArrayUpdate> {
    if !is_variable_size_tick_array {
        // Fixed size tick arrays don't need to be updated
        return Ok(TickArrayUpdate::default());
    }

    let mut transfer_rent = TickArrayRentTransfer::None;
    let mut size_update = TickArraySizeUpdate::None;

    // If liquidity is 0 and is being increased, transfer rent to tick array
    // As this might potentially initialize a new tick in the array
    if position.liquidity == 0 && position_update.liquidity != 0 {
        transfer_rent = TickArrayRentTransfer::TransferToTickArray;
    }

    // If liquidity is being decreased to 0, transfer rent to position
    // As this might potentially deinitialize a tick in the array
    if position.liquidity != 0 && position_update.liquidity == 0 {
        transfer_rent = TickArrayRentTransfer::TransferToPosition;
    }

    // If tick is not initialized and is being initialized, increase tick array size
    if !tick.initialized && tick_update.initialized {
        size_update = TickArraySizeUpdate::Increase;
    }

    // If tick is initialized and is being deinitialized, decrease tick array size
    if tick.initialized && !tick_update.initialized {
        size_update = TickArraySizeUpdate::Decrease;
    }

    Ok(TickArrayUpdate {
        transfer_rent,
        size_update,
    })
}

// Always collect the rent for initializing two ticks. At this point, we don't know
// if the TAs are variable size or not, so we always collect the rent for two ticks.
//
// If the TAs are variable size, the rent for the ticks will be transferred to and from
// the tick array accounts when (no longer) needed, and will be refunded when the position is closed.
//
// If the TAs are not variable size, the rent for the ticks will just remain in
// the position account, and will be refunded when the position is closed.
pub fn collect_rent_for_ticks_in_position<'info>(
    funder: &Signer<'info>,
    position: &Account<'info, Position>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let rent_amount = get_tick_rent_amount()? * 2;

    let position_account = position.to_account_info();
    let instruction = system_instruction::transfer(funder.key, position_account.key, rent_amount);
    let account_infos = [
        funder.to_account_info(),
        position_account.to_account_info(),
        system_program.to_account_info(),
    ];
    invoke(&instruction, &account_infos)?;

    Ok(())
}

pub fn update_tick_array_accounts<'info>(
    position: &Account<'info, Position>,
    lower_tick_array: AccountInfo<'info>,
    upper_tick_array: AccountInfo<'info>,
    lower_tick_array_update: &TickArrayUpdate,
    upper_tick_array_update: &TickArrayUpdate,
) -> Result<()> {
    let tick_rent_amount = get_tick_rent_amount()?;

    lower_tick_array_update
        .transfer_rent
        .execute(position, &lower_tick_array, tick_rent_amount)?;
    upper_tick_array_update
        .transfer_rent
        .execute(position, &upper_tick_array, tick_rent_amount)?;

    lower_tick_array_update
        .size_update
        .execute(&lower_tick_array)?;
    upper_tick_array_update
        .size_update
        .execute(&upper_tick_array)?;

    // Verify that the tick arrays are rent-exempt
    verify_rent_exempt(&position.to_account_info())?;
    verify_rent_exempt(&lower_tick_array)?;
    verify_rent_exempt(&upper_tick_array)?;

    Ok(())
}

fn transfer_rent_to_tick_array<'info>(
    tick_array_account: &AccountInfo<'info>,
    position: &Account<'info, Position>,
    amount: u64,
) -> Result<()> {
    let position_account = position.to_account_info();
    let mut position_lamports = position_account.try_borrow_mut_lamports()?;
    let mut tick_array_lamports = tick_array_account.try_borrow_mut_lamports()?;
    **position_lamports = position_lamports
        .checked_sub(amount)
        .ok_or(ErrorCode::RentCalculationError)?;
    **tick_array_lamports = tick_array_lamports
        .checked_add(amount)
        .ok_or(ErrorCode::RentCalculationError)?;
    Ok(())
}

fn transfer_rent_to_position<'info>(
    tick_array_account: &AccountInfo<'info>,
    position: &Account<'info, Position>,
    amount: u64,
) -> Result<()> {
    let position_account = position.to_account_info();
    let mut position_lamports = position_account.try_borrow_mut_lamports()?;
    let mut tick_array_lamports = tick_array_account.try_borrow_mut_lamports()?;
    **position_lamports = position_lamports
        .checked_add(amount)
        .ok_or(ErrorCode::RentCalculationError)?;
    **tick_array_lamports = tick_array_lamports
        .checked_sub(amount)
        .ok_or(ErrorCode::RentCalculationError)?;
    Ok(())
}

fn increase_tick_array_size(tick_array_account: &AccountInfo) -> Result<()> {
    let tick_array_account_info = tick_array_account.to_account_info();
    let required_size = tick_array_account_info.data_len() + TICK_INITIALIZATION_SIZE;
    tick_array_account_info.realloc(required_size, true)?;
    Ok(())
}

fn decrease_tick_array_size(tick_array_account: &AccountInfo) -> Result<()> {
    let tick_array_account_info = tick_array_account.to_account_info();
    let required_size = tick_array_account_info.data_len() - TICK_INITIALIZATION_SIZE;
    tick_array_account_info.realloc(required_size, true)?;
    Ok(())
}

fn verify_rent_exempt(account_info: &AccountInfo) -> Result<()> {
    let rent = Rent::get()?;
    if !rent.is_exempt(account_info.lamports(), account_info.data_len()) {
        return Err(ProgramError::AccountNotRentExempt.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        position_builder::PositionBuilder, tick_builder::TickBuilder, PositionUpdate, TickUpdate,
    };

    #[test]
    fn test_fixed_size_tick_array() {
        let position = PositionBuilder::default().liquidity(100).build();
        let position_update = PositionUpdate {
            liquidity: 200,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            false, // Fixed size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::None);
        assert_eq!(result.transfer_rent, TickArrayRentTransfer::None);
    }

    #[test]
    fn test_increase_liquidity() {
        let position = PositionBuilder::default().liquidity(100).build();
        let position_update = PositionUpdate {
            liquidity: 200,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::None);
        assert_eq!(result.transfer_rent, TickArrayRentTransfer::None);
    }

    #[test]
    fn test_increase_liquidity_from_zero() {
        let position = PositionBuilder::default().liquidity(0).build();
        let position_update = PositionUpdate {
            liquidity: 200,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::None);
        assert_eq!(
            result.transfer_rent,
            TickArrayRentTransfer::TransferToTickArray
        );
    }

    #[test]
    fn test_decrease_liquidity() {
        let position = PositionBuilder::default().liquidity(200).build();
        let position_update = PositionUpdate {
            liquidity: 100,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::None);
        assert_eq!(result.transfer_rent, TickArrayRentTransfer::None);
    }

    #[test]
    fn test_decrease_liquidity_to_zero() {
        let position = PositionBuilder::default().liquidity(200).build();
        let position_update = PositionUpdate {
            liquidity: 0,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::None);
        assert_eq!(
            result.transfer_rent,
            TickArrayRentTransfer::TransferToPosition
        );
    }

    #[test]
    fn test_zero_liquidity_change() {
        let position = PositionBuilder::default().liquidity(0).build();
        let position_update = PositionUpdate {
            liquidity: 0,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::None);
        assert_eq!(result.transfer_rent, TickArrayRentTransfer::None);
    }

    #[test]
    fn test_initialize_tick() {
        let position = PositionBuilder::default().liquidity(100).build();
        let position_update = PositionUpdate {
            liquidity: 200,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(false).build();
        let tick_update = TickUpdate {
            initialized: true,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::Increase);
        assert_eq!(result.transfer_rent, TickArrayRentTransfer::None);
    }

    #[test]
    fn test_deinitialize_tick() {
        let position = PositionBuilder::default().liquidity(200).build();
        let position_update = PositionUpdate {
            liquidity: 100,
            ..Default::default()
        };
        let tick = TickBuilder::default().initialized(true).build();
        let tick_update = TickUpdate {
            initialized: false,
            ..Default::default()
        };

        let result = calculate_modify_tick_array(
            &position,
            &position_update,
            true, // Variable size
            &tick,
            &tick_update,
        )
        .unwrap();

        assert_eq!(result.size_update, TickArraySizeUpdate::Decrease);
        assert_eq!(result.transfer_rent, TickArrayRentTransfer::None);
    }
}
