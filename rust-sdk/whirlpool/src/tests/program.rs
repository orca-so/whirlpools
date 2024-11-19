use orca_whirlpools_client::{
    get_fee_tier_address, InitializeFeeTier, InitializeFeeTierInstructionArgs,
};
use solana_program::system_program::ID as SYSTEM_PROGRAM_ID;
use solana_sdk::{pubkey::Pubkey, signer::Signer};
use std::error::Error;

use crate::{SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS};

use super::{send_transaction, SIGNER};

pub fn setup_fee_tiers() -> Result<(), Box<dyn Error>> {
    let config = *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?;

    let mut instructions = Vec::new();

    let default_fee_tier = get_fee_tier_address(&config, 128)?;
    instructions.push(
        InitializeFeeTier {
            config,
            fee_tier: default_fee_tier.0,
            funder: SIGNER.pubkey(),
            fee_authority: SIGNER.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
        }
        .instruction(InitializeFeeTierInstructionArgs {
            tick_spacing: 128,
            default_fee_rate: 1000,
        }),
    );

    let concentrated_fee_tier = get_fee_tier_address(&config, 64)?;
    instructions.push(
        InitializeFeeTier {
            config,
            fee_tier: concentrated_fee_tier.0,
            funder: SIGNER.pubkey(),
            fee_authority: SIGNER.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
        }
        .instruction(InitializeFeeTierInstructionArgs {
            tick_spacing: 64,
            default_fee_rate: 300,
        }),
    );

    let splash_fee_tier = get_fee_tier_address(&config, SPLASH_POOL_TICK_SPACING)?;
    instructions.push(
        InitializeFeeTier {
            config,
            fee_tier: splash_fee_tier.0,
            funder: SIGNER.pubkey(),
            fee_authority: SIGNER.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
        }
        .instruction(InitializeFeeTierInstructionArgs {
            tick_spacing: SPLASH_POOL_TICK_SPACING,
            default_fee_rate: 1000,
        }),
    );

    send_transaction(instructions)?;

    Ok(())
}

pub fn setup_whirlpool() -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}

pub fn setup_position(whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}

pub fn setup_te_position(whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}

pub fn setup_position_bundle(whirlpool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    todo!()
}
