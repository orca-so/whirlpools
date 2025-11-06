#![allow(unexpected_cfgs)]

use anchor_lang::Discriminator;
use pinocchio::account_info::AccountInfo;
use solana_program::{custom_heap_default, custom_panic_default};

const MAX_TX_ACCOUNTS: usize = 64;

#[cfg(feature = "whirlpool-entrypoint")]
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    type PinocchioInstructionHandler = fn(&[AccountInfo], &[u8]) -> crate::pinocchio::Result<()>;
    const PINOCCHIO_INSTRUCTIONS: [(&[u8], PinocchioInstructionHandler); 2] = [
        (crate::instruction::IncreaseLiquidityV2::DISCRIMINATOR, crate::pinocchio::instructions::increase_liquidity_v2::handler),
        (crate::instruction::DecreaseLiquidityV2::DISCRIMINATOR, crate::pinocchio::instructions::decrease_liquidity_v2::handler),
        // add other discriminators and handlers here as needed
        // note: sort by the frequency of usage to optimize the search speed [swap ops..., liq ops..., ...]
    ];

    // pinocchio instructions
    const UNINIT: core::mem::MaybeUninit<pinocchio::account_info::AccountInfo> =
        core::mem::MaybeUninit::<pinocchio::account_info::AccountInfo>::uninit();
    let mut accounts = [UNINIT; MAX_TX_ACCOUNTS];
    // We do not check the correctness of program_id here because we are already in the program's entrypoint.
    let (_program_id, count, instruction_data) =
        pinocchio::entrypoint::deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts);
    let matched_pinocchio_instruction = PINOCCHIO_INSTRUCTIONS
        .iter()
        .find(|pix|instruction_data.starts_with(pix.0));
    if let Some((_, handler)) = matched_pinocchio_instruction {
        // We do not output instruction name to save compute units.

        let parsed_accounts = core::slice::from_raw_parts(accounts.as_ptr() as _, count);

        return match handler(
            parsed_accounts,
            instruction_data,
        ) {
            Ok(()) => solana_program::entrypoint::SUCCESS,
            Err(e) => e.into(),
        };
    }

    // fallback to SolanaProgram & Anchor instructions
    let (program_id, accounts, instruction_data) =
        unsafe { solana_program::entrypoint::deserialize(input) };
    match crate::entry(program_id, &accounts, instruction_data) {
        Ok(()) => solana_program::entrypoint::SUCCESS,
        Err(e) => e.into(),
    }
}

custom_heap_default!();
custom_panic_default!();
