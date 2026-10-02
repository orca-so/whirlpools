use anchor_lang::{prelude::*, system_program};

use crate::{
    state::*,
    util::{get_dynamic_tick_array_minimum_rent_amount, safe_create_account},
    ID,
};

#[derive(Accounts)]
#[instruction(start_tick_index: i32)]
pub struct InitializeDynamicTickArray<'info> {
    pub whirlpool: Account<'info, Whirlpool>,

    #[account(mut)]
    pub funder: Signer<'info>,

    // We cannot use init_if_needed here because it requires a space constraint which
    // can fail because the dynamic tick array's space is not constant.
    #[account(
      mut,
      seeds = [b"tick_array", whirlpool.key().as_ref(), start_tick_index.to_string().as_bytes()],
      bump,
    )]
    /// CHECK: We don't need to check the account here because we're initializing it.
    pub tick_array: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeDynamicTickArray>,
    start_tick_index: i32,
    idempotent: bool,
) -> Result<()> {
    if ctx.accounts.tick_array.owner == &system_program::ID {
        let rent_with_reduction_fallback_margin = get_dynamic_tick_array_minimum_rent_amount()?;
        safe_create_account(
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.funder.to_account_info(),
            ctx.accounts.tick_array.to_account_info(),
            &ID,
            rent_with_reduction_fallback_margin,
            DynamicTickArray::MIN_LEN as u64,
            &[&[
                b"tick_array",
                ctx.accounts.whirlpool.key().as_ref(),
                start_tick_index.to_string().as_bytes(),
                &[ctx.bumps.tick_array],
            ]],
        )?;
    }

    if ctx.accounts.tick_array.owner != &crate::ID {
        return Err(ErrorCode::AccountOwnedByWrongProgram.into());
    }

    let mut data = ctx.accounts.tick_array.try_borrow_mut_data()?;
    let is_initialized = data[0..8] != [0; 8];
    if !is_initialized {
        data[0..8].copy_from_slice(DynamicTickArray::DISCRIMINATOR);
        let tick_array = DynamicTickArrayLoader::load_mut(&mut data[8..]);
        tick_array.initialize(&ctx.accounts.whirlpool, start_tick_index)
    } else if idempotent
        && (data[0..8] == *DynamicTickArray::DISCRIMINATOR
            || data[0..8] == *FixedTickArray::DISCRIMINATOR)
    {
        Ok(())
    } else {
        Err(ErrorCode::AccountDiscriminatorAlreadySet.into())
    }
}
