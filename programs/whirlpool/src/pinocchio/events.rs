use arrayvec::ArrayVec;
use borsh::BorshSerialize;
use pinocchio::{program_error::ProgramError, pubkey::Pubkey};

use crate::pinocchio::Result;

const SERIALIZED_EVENT_MAX_SIZE: usize = 256;

#[derive(Debug, Clone, BorshSerialize)]
pub enum Event<'a> {
    LiquidityIncreased {
        whirlpool: &'a Pubkey,
        position: &'a Pubkey,
        tick_lower_index: i32,
        tick_upper_index: i32,
        liquidity: u128,
        token_a_amount: u64,
        token_b_amount: u64,
        token_a_transfer_fee: u64,
        token_b_transfer_fee: u64,
    },
    LiquidityDecreased {
        whirlpool: &'a Pubkey,
        position: &'a Pubkey,
        tick_lower_index: i32,
        tick_upper_index: i32,
        liquidity: u128,
        token_a_amount: u64,
        token_b_amount: u64,
        token_a_transfer_fee: u64,
        token_b_transfer_fee: u64,
    },
    LiquidityRepositioned {
        whirlpool: &'a Pubkey,
        position: &'a Pubkey,
        old_tick_lower_index: i32,
        old_tick_upper_index: i32,
        new_tick_lower_index: i32,
        new_tick_upper_index: i32,
        old_liquidity: u128,
        new_liquidity: u128,
        old_token_a_amount: u64,
        old_token_b_amount: u64,
        new_token_a_amount: u64,
        new_token_b_amount: u64,
    },
}

fn pino_sol_log_data(data: &[&[u8]]) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_log_data(data as *const _ as *const u8, data.len() as u64)
    };

    #[cfg(not(target_os = "solana"))]
    core::hint::black_box(data);
}

impl Event<'_> {
    fn to_anchor_discriminator(&self) -> &[u8] {
        use anchor_lang::Discriminator;
        match self {
            Event::LiquidityIncreased { .. } => crate::events::LiquidityIncreased::DISCRIMINATOR,
            Event::LiquidityDecreased { .. } => crate::events::LiquidityDecreased::DISCRIMINATOR,
            Event::LiquidityRepositioned { .. } => {
                crate::events::LiquidityRepositioned::DISCRIMINATOR
            }
        }
    }

    pub fn emit(&self) -> Result<()> {
        let discriminator = self.to_anchor_discriminator();

        let mut serialized_event = ArrayVec::<u8, SERIALIZED_EVENT_MAX_SIZE>::new();
        // d: discriminator, v: enum variant, e: event data
        // write the first 7 bytes of discriminator
        // ddddddd
        serialized_event
            .try_extend_from_slice(discriminator[..7].as_ref())
            .map_err(|_| ProgramError::BorshIoError)?;
        // write the enum variant byte and event data
        // dddddddveeeee...
        self.serialize(&mut serialized_event)?;
        // overwrite the 8th byte of discriminator
        // ddddddddeeeee...
        serialized_event[7] = discriminator[7];

        pino_sol_log_data(&[&serialized_event]);
        Ok(())
    }
}
