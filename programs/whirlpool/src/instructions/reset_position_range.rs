use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount as TokenAccountInterface;
use solana_program::program::invoke;
use solana_program::system_instruction;

use crate::manager::tick_array_manager::get_tick_rent_amount;
use crate::state::*;
use crate::util::verify_position_authority_interface;

#[derive(Accounts)]
pub struct ResetPositionRange<'info> {
    // Maybe used in the future
    #[account(mut)]
    pub funder: Signer<'info>,

    pub position_authority: Signer<'info>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    // Constraint checked via verify_position_authority
    #[account(mut, has_one = whirlpool)]
    pub position: Box<Account<'info, Position>>,

    #[account(
        constraint = position_token_account.amount == 1,
        constraint = position_token_account.mint == position.position_mint)]
    pub position_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    // Maybe used in the future
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ResetPositionRange>,
    new_tick_lower_index: i32,
    new_tick_upper_index: i32,
) -> Result<()> {
    verify_position_authority_interface(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    ensure_position_has_enough_rent_for_ticks(
        &ctx.accounts.funder,
        &ctx.accounts.position,
        &ctx.accounts.system_program,
    )?;

    ctx.accounts.position.reset_position_range(
        &ctx.accounts.whirlpool,
        new_tick_lower_index,
        new_tick_upper_index,
    )
}

fn ensure_position_has_enough_rent_for_ticks<'info>(
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
