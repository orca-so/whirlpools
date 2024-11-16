use orca_whirlpools_client::{
    get_fee_tier_address, InitializeConfig, InitializeConfigInstructionArgs, InitializeFeeTier,
    InitializeFeeTierInstructionArgs,
};
use solana_program::system_program::ID as SYSTEM_PROGRAM_ID;
use solana_sdk::{pubkey::Pubkey, signer::Signer};
use std::error::Error;

use crate::SPLASH_POOL_TICK_SPACING;

use super::{get_next_keypair, send_transaction_with_signers, SIGNER};

pub fn setup_config_and_fee_tiers() -> Result<Pubkey, Box<dyn Error>> {
    let keypair = get_next_keypair();

    let mut instructions = vec![InitializeConfig {
        config: keypair.pubkey(),
        funder: SIGNER.pubkey(),
        system_program: SYSTEM_PROGRAM_ID,
    }
    .instruction(InitializeConfigInstructionArgs {
        fee_authority: SIGNER.pubkey(),
        collect_protocol_fees_authority: SIGNER.pubkey(),
        reward_emissions_super_authority: SIGNER.pubkey(),
        default_protocol_fee_rate: 100,
    })];

    let default_fee_tier = get_fee_tier_address(&keypair.pubkey(), 128)?;
    instructions.push(
        InitializeFeeTier {
            config: keypair.pubkey(),
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

    let concentrated_fee_tier = get_fee_tier_address(&keypair.pubkey(), 64)?;
    instructions.push(
        InitializeFeeTier {
            config: keypair.pubkey(),
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

    let splash_fee_tier = get_fee_tier_address(&keypair.pubkey(), SPLASH_POOL_TICK_SPACING)?;
    instructions.push(
        InitializeFeeTier {
            config: keypair.pubkey(),
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

    send_transaction_with_signers(instructions, vec![keypair])?;

    Ok(keypair.pubkey())
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

// export async function setupConfigAndFeeTiers(): Promise<Address> {
//   const keypair = await generateKeyPairSigner();
//   const instructions: IInstruction[] = [];

//   instructions.push(
//     getInitializeConfigInstruction({
//       config: keypair,
//       funder: signer,
//       feeAuthority: signer.address,
//       collectProtocolFeesAuthority: signer.address,
//       rewardEmissionsSuperAuthority: signer.address,
//       defaultProtocolFeeRate: 100,
//     }),
//   );

//   const defaultFeeTierPda = await getFeeTierAddress(keypair.address, 128);
//   instructions.push(
//     getInitializeFeeTierInstruction({
//       config: keypair.address,
//       feeTier: defaultFeeTierPda[0],
//       funder: signer,
//       feeAuthority: signer,
//       tickSpacing: 128,
//       defaultFeeRate: 1000,
//     }),
//   );

//   const concentratedFeeTierPda = await getFeeTierAddress(keypair.address, 64);
//   instructions.push(
//     getInitializeFeeTierInstruction({
//       config: keypair.address,
//       feeTier: concentratedFeeTierPda[0],
//       funder: signer,
//       feeAuthority: signer,
//       tickSpacing: 64,
//       defaultFeeRate: 300,
//     }),
//   );

//   const splashFeeTierPda = await getFeeTierAddress(
//     keypair.address,
//     SPLASH_POOL_TICK_SPACING,
//   );
//   instructions.push(
//     getInitializeFeeTierInstruction({
//       config: keypair.address,
//       feeTier: splashFeeTierPda[0],
//       funder: signer,
//       feeAuthority: signer,
//       tickSpacing: SPLASH_POOL_TICK_SPACING,
//       defaultFeeRate: 1000,
//     }),
//   );

//   await sendTransaction(instructions);
//   return keypair.address;
// }

// export async function setupWhirlpool(
//   tokenA: Address,
//   tokenB: Address,
//   tickSpacing: number,
//   config: { initialSqrtPrice?: bigint } = {},
// ): Promise<Address> {
//   const feeTierAddress = await getFeeTierAddress(
//     WHIRLPOOLS_CONFIG_ADDRESS,
//     tickSpacing,
//   );
//   const whirlpoolAddress = await getWhirlpoolAddress(
//     WHIRLPOOLS_CONFIG_ADDRESS,
//     tokenA,
//     tokenB,
//     tickSpacing,
//   );
//   const vaultA = await generateKeyPairSigner();
//   const vaultB = await generateKeyPairSigner();

//   const sqrtPrice = config.initialSqrtPrice ?? tickIndexToSqrtPrice(0);

//   const instructions: IInstruction[] = [];

//   instructions.push(
//     getInitializePoolInstruction({
//       whirlpool: whirlpoolAddress[0],
//       feeTier: feeTierAddress[0],
//       tokenMintA: tokenA,
//       tokenMintB: tokenB,
//       tickSpacing,
//       whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
//       funder: signer,
//       tokenVaultA: vaultA,
//       tokenVaultB: vaultB,
//       whirlpoolBump: whirlpoolAddress[1],
//       initialSqrtPrice: sqrtPrice,
//     }),
//   );

//   await sendTransaction(instructions);
//   return whirlpoolAddress[0];
// }

// export async function setupPosition(
//   whirlpool: Address,
//   config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
// ): Promise<Address> {
//   // TODO: implement when solana-bankrun supports gpa
//   const _ = config;
//   return whirlpool;
// }

// export async function setupTEPosition(
//   whirlpool: Address,
//   config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
// ): Promise<Address> {
//   // TODO: implement when solana-bankrun supports gpa
//   const _ = config;
//   return whirlpool;
// }

// export async function setupPositionBundle(
//   whirlpool: Address,
//   config: { tickLower?: number; tickUpper?: number; liquidity?: bigint }[] = [],
// ): Promise<Address> {
//   // TODO: implement when solana-bankrun supports gpa
//   const _ = config;
//   return whirlpool;
// }
