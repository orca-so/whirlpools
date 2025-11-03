use anchor_lang::prelude::*;
use solana_program::program::invoke;
use solana_program::system_instruction;

use crate::manager::tick_array_manager::get_tick_rent_amount;
use crate::state::*;

pub fn ensure_position_has_enough_rent_for_ticks<'info>(
    funder: &Signer<'info>,
    position: &Account<'info, Position>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let rent = Rent::get()?;

    let position_rent_required = rent.minimum_balance(Position::LEN);
    let tick_required_rent = get_tick_rent_amount()? * 2;
    let all_required_rent = position_rent_required
        .checked_add(tick_required_rent)
        .ok_or(crate::errors::ErrorCode::RentCalculationError)?;

    let position_lamports = position.to_account_info().lamports();
    if position_lamports < all_required_rent {
        // If the position doesn't have enough rent, we need to transfer more SOL from the funder to the position
        let additional_rent_required = all_required_rent - position_lamports;

        // Safeguard
        if additional_rent_required > tick_required_rent {
            unreachable!(
                "The position account must hold sufficient rent-exempt balance for itself"
            );
        }
        let position_account = position.to_account_info();
        // Transfer the additional rent from the funder to the position
        let ix = system_instruction::transfer(
            funder.key,
            position_account.key,
            additional_rent_required,
        );
        let account_infos = [
            funder.to_account_info(),
            position_account,
            system_program.to_account_info(),
        ];
        invoke(&ix, &account_infos)?;
    }

    Ok(())
}
