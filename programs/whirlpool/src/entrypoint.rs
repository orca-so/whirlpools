#![allow(unexpected_cfgs)]

use anchor_lang::Discriminator;
use pinocchio::{account_info::AccountInfo, pubkey::Pubkey};
use solana_program::{custom_heap_default, custom_panic_default};

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Account {
    borrow_state: u8,
    is_signer: u8,
    is_writable: u8,
    executable: u8,
    original_data_len: u32,
    key: Pubkey,
    owner: Pubkey,
    lamports: u64,
    data_len: u64,
}

const NON_DUP_MARKER: u8 = u8::MAX;
const BPF_ALIGN_OF_U128: usize = 8;
const MAX_TX_ACCOUNTS: usize = 64;

unsafe fn peek_instruction_data<'a>(input: *mut u8) -> &'a [u8] {
    let mut offset: usize = 0;

    let total_accounts = *(input.add(offset) as *const u64) as usize;
    offset += core::mem::size_of::<u64>();

    for _i in 0..total_accounts {
        let account_info: *mut Account = input.add(offset) as *mut _;

        if (*account_info).borrow_state == NON_DUP_MARKER {
            offset += core::mem::size_of::<Account>();
            offset += (*account_info).data_len as usize;
            offset += pinocchio::account_info::MAX_PERMITTED_DATA_INCREASE;
            offset += (offset as *const u8).align_offset(BPF_ALIGN_OF_U128);
            offset += core::mem::size_of::<u64>();
        } else {
            offset += core::mem::size_of::<u64>();
        }
    }

    // instruction data
    let instruction_data_len = *(input.add(offset) as *const u64) as usize;
    offset += core::mem::size_of::<u64>();
    let instruction_data = { core::slice::from_raw_parts(input.add(offset), instruction_data_len) };

    instruction_data
}

#[cfg(feature = "whirlpool-entrypoint")]
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    type PinocchioInstructionHandler = fn(&[AccountInfo], &[u8]) -> crate::pinocchio::Result<()>;
    const PINOCCHIO_INSTRUCTIONS: [(&[u8], PinocchioInstructionHandler); 1] = [
        (crate::instruction::IncreaseLiquidityV2::DISCRIMINATOR, crate::pinocchio::instructions::increase_liquidity_v2::handler),
        // add other discriminators and handlers here as needed
        // note: sort by the frequency of usage to optimize the search speed [swap ops..., liq ops..., ...]
    ];

    let instruction_data = peek_instruction_data(input);

    // pinocchio way
    const UNINIT: core::mem::MaybeUninit<pinocchio::account_info::AccountInfo> =
        core::mem::MaybeUninit::<pinocchio::account_info::AccountInfo>::uninit();
    let mut accounts = [UNINIT; MAX_TX_ACCOUNTS];
    let matched_pinocchio_instruction = PINOCCHIO_INSTRUCTIONS
        .iter()
        .find(|pix|instruction_data.starts_with(pix.0));
    if let Some((_, handler)) = matched_pinocchio_instruction {
        let (_program_id, count, instruction_data) =
            pinocchio::entrypoint::deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts);

        // TODO: should we check the correctness of program_id here?
        // I guess it is safe to skip the check because we are already in the program's entrypoint...
        // Am I missing something?

        let parsed_accounts = core::slice::from_raw_parts(accounts.as_ptr() as _, count);

        return match handler(
            parsed_accounts,
            instruction_data,
        ) {
            Ok(()) => solana_program::entrypoint::SUCCESS,
            // TODO: logging
            Err(error) => error.into(),
        };
    }

    // fallback to SolanaProgram & Anchor way
    let (program_id, accounts, instruction_data) =
        unsafe { solana_program::entrypoint::deserialize(input) };
    match crate::entry(program_id, &accounts, instruction_data) {
        Ok(()) => solana_program::entrypoint::SUCCESS,
        Err(error) => error.into(),
    }
}

custom_heap_default!();
custom_panic_default!();
