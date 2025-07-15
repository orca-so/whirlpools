use anchor_lang::prelude::*;
use solana_program::{program::invoke_signed, system_instruction};
use std::cmp::max;

pub fn safe_create_account<'info>(
    system_program: AccountInfo<'info>,
    funder: AccountInfo<'info>,
    new_account: AccountInfo<'info>,
    owner_program: &Pubkey,
    minimum_lamports: u64,
    space: u64,
    signers_seeds: &[&[&[u8]]],
) -> Result<()> {
    if new_account.owner != &system_program.key() {
        return Err(ErrorCode::AccountOwnedByWrongProgram.into());
    }

    let current_lamports = new_account.lamports();

    if current_lamports > 0 {
        // If there is already a balance, `create_account` fails.
        // We can either do `transfer`, `assign` and `allocate` manually
        // or just clear out the account before proceeding.
        invoke_signed(
            &system_instruction::transfer(new_account.key, funder.key, current_lamports),
            &[system_program.clone(), new_account.clone(), funder.clone()],
            signers_seeds,
        )?;
    }

    // If there was already a balance, we want to send it all back to the account. If there
    // was no balance (or below minimum_lamports), we just want the lamports to be at least minimum_lamports.
    let next_lamports = max(minimum_lamports, current_lamports);

    // create account
    invoke_signed(
        &system_instruction::create_account(
            funder.key,
            new_account.key,
            next_lamports,
            space,
            owner_program,
        ),
        &[system_program, funder, new_account],
        signers_seeds,
    )?;

    Ok(())
}
