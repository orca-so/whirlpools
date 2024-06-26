use std::{cell::{RefCell, RefMut}, collections::VecDeque};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    manager::swap_manager::*,
    state::{TickArray, Whirlpool, MAX_TICK_INDEX, MIN_TICK_INDEX, TICK_ARRAY_SIZE},
    util::{to_timestamp_u64, update_and_swap_whirlpool, SwapTickSequence},
};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    pub token_authority: Signer<'info>,

    #[account(mut)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_a)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_b)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    // #[account(mut, has_one = whirlpool)]
    // pub tick_array_0: AccountLoader<'info, TickArray>,
    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_0: UncheckedAccount<'info>,

    // #[account(mut, has_one = whirlpool)]
    // pub tick_array_1: AccountLoader<'info, TickArray>,
    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_1: UncheckedAccount<'info>,

    // #[account(mut, has_one = whirlpool)]
    // pub tick_array_2: AccountLoader<'info, TickArray>,
    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_2: UncheckedAccount<'info>,

    #[account(seeds = [b"oracle", whirlpool.key().as_ref()],bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<Swap>,
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool, // Zero for one
) -> Result<()> {
    let whirlpool = &mut ctx.accounts.whirlpool;
    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    let mut virtual_zero_tick_arrays: [Option<Box<RefCell<TickArray>>>; 3] = [None, None, None];
    let provided_tick_array_accounts = vec![
        ctx.accounts.tick_array_0.to_account_info(),
        ctx.accounts.tick_array_1.to_account_info(),
        ctx.accounts.tick_array_2.to_account_info(),
    ];
    let mut provided_tick_array_account_refs = provided_tick_array_accounts.iter().collect::<Vec<_>>();
    let mut swap_tick_sequence = build_swap_tick_sequence(
        &whirlpool,
        a_to_b,
        &mut virtual_zero_tick_arrays,
        &mut provided_tick_array_account_refs,
    )?;
/*
    let mut swap_tick_sequence = SwapTickSequence::new(
        ctx.accounts.tick_array_0.load_mut().unwrap(),
        ctx.accounts.tick_array_1.load_mut().ok(),
        ctx.accounts.tick_array_2.load_mut().ok(),
    );
*/
    let swap_update = swap(
        &whirlpool,
        &mut swap_tick_sequence,
        amount,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        timestamp,
    )?;

    if amount_specified_is_input {
        if (a_to_b && other_amount_threshold > swap_update.amount_b)
            || (!a_to_b && other_amount_threshold > swap_update.amount_a)
        {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        if (a_to_b && other_amount_threshold < swap_update.amount_a)
            || (!a_to_b && other_amount_threshold < swap_update.amount_b)
        {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    update_and_swap_whirlpool(
        whirlpool,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_program,
        swap_update,
        a_to_b,
        timestamp,
    )
}


fn build_swap_tick_sequence<'a, 't, 'info>(
    whirlpool: &'t Account<'info, Whirlpool>,
    a_to_b: bool,
    virtual_zero_tick_arrays: &'a mut [Option<Box<RefCell<TickArray>>>; 3],
    provided_tick_array_account_refs: &'a mut Vec<&'a AccountInfo<'info>>,
) -> Result<SwapTickSequence<'a>> {
    // dedup by key
    provided_tick_array_account_refs.sort_by_key(|a| a.key());
    provided_tick_array_account_refs.dedup_by_key(|a| a.key());

    let mut initialized = vec![];
    let mut uninitialized = vec![];
    for account_info in provided_tick_array_account_refs {
        match load_tick_array_mut(account_info)? {
            TickArrayAccountState::Initialized(tick_array) => {
                // has_one constraint equivalent check
                if tick_array.whirlpool != whirlpool.key() {
                    // TODO: our own error definition
                    return Err(anchor_lang::error::ErrorCode::ConstraintHasOne.into());
                }

                initialized.push(tick_array);
            }
            TickArrayAccountState::Uninitialized(pubkey) => {
                uninitialized.push(pubkey);
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////
    // Now successfully loaded tick arrays have been verified as:
    // - Owned by Whirlpool Program
    // - Initialized as TickArray account
    // - And has_one constraint is satisfied (i.e. belongs to trading whirlpool)
    // - Writable
    ////////////////////////////////////////////////////////////////////////
    let tick_current_index = whirlpool.tick_current_index;
    let tick_spacing = whirlpool.tick_spacing as i32;
    let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing;

    let start_tick_index_base = floor_division(tick_current_index, ticks_in_array) * ticks_in_array;
    let offset = if a_to_b {
        [0, -1, -2]
    } else {
        let shifted = tick_current_index + tick_spacing >= start_tick_index_base + ticks_in_array;
        if shifted { [1, 2, 3] } else { [0, 1, 2] }
    };

    let start_tick_indexes = offset
        .iter()
        .filter_map(|&o| {
            let start_tick_index = start_tick_index_base + o * ticks_in_array;
            let valid = start_tick_index + ticks_in_array > MIN_TICK_INDEX && start_tick_index < MAX_TICK_INDEX;
            if valid {
                Some(start_tick_index)
            } else {
                None
            }
        })
        .collect::<Vec<i32>>();

    // TODO: debug
    msg!("tick_current_index: {}, ts: {}, ticks_in_array: {}", tick_current_index, tick_spacing, ticks_in_array);
    msg!("a_to_b: {}", a_to_b);
    msg!("start_tick_indexes: {:?}", start_tick_indexes);

    // to make virtual
    for (i, start_tick_index) in start_tick_indexes.iter().enumerate() {
        // find from initialized tick arrays
        if let Some(pos) = initialized.iter().position(|tick_array| tick_array.start_tick_index == *start_tick_index) {
            continue;
        }

        // find from uninitialized tick arrays
        let tick_array_pda = derive_tick_array_pda(whirlpool, *start_tick_index);
        if let Some(pos) = uninitialized.iter().position(|key| key == &tick_array_pda) {
            let virtual_zero_tick_array = Some(Box::new(RefCell::new(TickArray::default())));
            virtual_zero_tick_array.as_ref().unwrap().borrow_mut().initialize(whirlpool, *start_tick_index)?;
            virtual_zero_tick_arrays[i] = virtual_zero_tick_array;
            continue;
        }

        // no more valid tickarrays for this swap
        break;
    }

    let mut refmut_tick_arrays = VecDeque::with_capacity(3);
    for (i, start_tick_index) in start_tick_indexes.iter().enumerate() {
        // find from initialized tick arrays
        if let Some(pos) = initialized.iter().position(|tick_array| tick_array.start_tick_index == *start_tick_index) {
            refmut_tick_arrays.push_back(initialized.remove(pos));
            continue;
        }

        // find from uninitialized tick arrays
        let tick_array_pda = derive_tick_array_pda(whirlpool, *start_tick_index);
        if let Some(pos) = uninitialized.iter().position(|key| key == &tick_array_pda) {
            uninitialized.remove(pos);

            //let x = virtual_zero_tick_array.as_ref().as_ref().unwrap().borrow_mut();
            let refmut_tick_array = virtual_zero_tick_arrays[i].as_ref().as_ref().unwrap().borrow_mut();            
            refmut_tick_arrays.push_back(refmut_tick_array);
            continue;
        }

        // no more valid tickarrays for this swap
        break;
    }

    // TODO: debug
    msg!("refmut_tick_arrays len: {}", refmut_tick_arrays.len());
    for r in &refmut_tick_arrays {
        let s = r.start_tick_index;
        msg!("start_tick_index: {}", s);
    }

    if refmut_tick_arrays.is_empty() {
        // TODO: define specific error
        return Err(crate::errors::ErrorCode::InvalidTickArraySequence.into());
    }

    Ok(SwapTickSequence::<'a>::new(
        refmut_tick_arrays.pop_front().unwrap(),
        refmut_tick_arrays.pop_front(),
        refmut_tick_arrays.pop_front(),
    ))
}

enum TickArrayAccountState<'a> {
    // owned by this whirlpool program and its discriminator is valid and writable
    // but not sure if this TickArray is valid for this whirlpool (maybe for another whirlpool)
    Initialized(RefMut<'a, TickArray>),
    // owned by system program and its data size is zero and writable
    // but not sure if this key is valid PDA for TickArray
    Uninitialized(Pubkey),
}

fn load_tick_array_mut<'a, 'info>(
    account_info: &'a AccountInfo<'info>,
) -> Result<TickArrayAccountState<'a>> {
    use anchor_lang::Discriminator;
    use std::ops::DerefMut;

    // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut

    if !account_info.is_writable {
        return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
    }

    // uninitialized writable account (owned by system program and its data size is zero)
    if account_info.owner == &System::id() && account_info.data_is_empty() {
        return Ok(TickArrayAccountState::Uninitialized(*account_info.key));
    }

    // owner program check
    if account_info.owner != &TickArray::owner() {
        return Err(Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
            .with_pubkeys((*account_info.owner, TickArray::owner())));
    }

    let data = account_info.try_borrow_mut_data()?;
    if data.len() < TickArray::discriminator().len() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let disc_bytes = arrayref::array_ref![data, 0, 8];
    if disc_bytes != &TickArray::discriminator() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }

    Ok(TickArrayAccountState::Initialized(RefMut::map(data, |data| {
        bytemuck::from_bytes_mut(&mut data.deref_mut()[8..std::mem::size_of::<TickArray>() + 8])
    })))
}

fn floor_division(dividend: i32, divisor: i32) -> i32 {
    assert!(divisor != 0, "Divisor cannot be zero.");
    if dividend % divisor == 0 || dividend.signum() == divisor.signum() {
        dividend / divisor
    } else {
        dividend / divisor - 1
    }
}

fn derive_tick_array_pda(
    whirlpool: &Account<Whirlpool>,
    start_tick_index: i32,
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"tick_array",
            whirlpool.key().as_ref(),
            start_tick_index.to_string().as_bytes(),
        ],
        &TickArray::owner()
    ).0
}