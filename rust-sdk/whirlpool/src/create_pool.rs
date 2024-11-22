use std::collections::HashSet;
use std::error::Error;

use orca_whirlpools_client::{
    get_fee_tier_address, get_tick_array_address, get_token_badge_address, get_whirlpool_address,
};
use orca_whirlpools_client::{
    InitializePoolV2, InitializePoolV2InstructionArgs, InitializeTickArray,
    InitializeTickArrayInstructionArgs,
};
use orca_whirlpools_client::{TickArray, Whirlpool};
use orca_whirlpools_core::{
    get_full_range_tick_indexes, get_tick_array_start_tick_index, price_to_sqrt_price,
    sqrt_price_to_tick_index,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::rent::Rent;
use solana_program::system_program;
use solana_program::sysvar::SysvarId;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use spl_token::solana_program::program_pack::Pack;
use spl_token_2022::state::{Account, Mint};

use crate::token::order_mints;
use crate::{get_rent, FUNDER, SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS};

/// Represents the instructions and metadata for creating a pool.
pub struct CreatePoolInstructions {
    /// The list of instructions needed to create the pool.
    pub instructions: Vec<Instruction>,

    /// The estimated rent exemption cost for initializing the pool, in lamports.
    pub initialization_cost: u64,

    /// The address of the newly created pool.
    pub pool_address: Pubkey,

    /// The list of signers for the instructions.
    pub additional_signers: Vec<Keypair>,
}

pub async fn create_splash_pool_instructions(
    rpc: &RpcClient,
    token_a: Pubkey,
    token_b: Pubkey,
    initial_price: Option<f64>,
    funder: Option<Pubkey>,
) -> Result<CreatePoolInstructions, Box<dyn Error>> {
    create_concentrated_liquidity_pool_instructions(
        rpc,
        token_a,
        token_b,
        SPLASH_POOL_TICK_SPACING,
        initial_price,
        funder,
    )
    .await
}

pub async fn create_concentrated_liquidity_pool_instructions(
    rpc: &RpcClient,
    token_a: Pubkey,
    token_b: Pubkey,
    tick_spacing: u16,
    initial_price: Option<f64>,
    funder: Option<Pubkey>,
) -> Result<CreatePoolInstructions, Box<dyn Error>> {
    let initial_price = initial_price.unwrap_or(1.0);
    let funder = funder.unwrap_or(*FUNDER.try_lock()?);
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }
    if order_mints(token_a, token_b)[0] != token_a {
        return Err("Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)".into());
    }

    let rent = get_rent(rpc).await?;

    let account_infos = rpc.get_multiple_accounts(&[token_a, token_b]).await?;
    let mint_a_info = account_infos[0]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_a))?;
    let mint_a = Mint::unpack(&mint_a_info.data)?;
    let decimals_a = mint_a.decimals;
    let token_program_a = mint_a_info.owner;
    let mint_b_info = account_infos[1]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_b))?;
    let mint_b = Mint::unpack(&mint_b_info.data)?;
    let decimals_b = mint_b.decimals;
    let token_program_b = mint_b_info.owner;

    let initial_sqrt_price: u128 = price_to_sqrt_price(initial_price, decimals_a, decimals_b);

    let pool_address = get_whirlpool_address(
        &*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?,
        &token_a,
        &token_b,
        tick_spacing,
    )?
    .0;

    let fee_tier = get_fee_tier_address(&*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?, tick_spacing)?.0;

    let token_badge_a =
        get_token_badge_address(&*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?, &token_a)?.0;

    let token_badge_b =
        get_token_badge_address(&*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?, &token_b)?.0;

    let token_vault_a = Keypair::new();
    let token_vault_b = Keypair::new();

    let mut initialization_cost: u64 = 0;
    let mut instructions = vec![];

    instructions.push(
        InitializePoolV2 {
            whirlpools_config: *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?,
            token_mint_a: token_a,
            token_mint_b: token_b,
            token_badge_a,
            token_badge_b,
            funder,
            whirlpool: pool_address,
            token_vault_a: token_vault_a.pubkey(),
            token_vault_b: token_vault_b.pubkey(),
            fee_tier,
            token_program_a,
            token_program_b,
            system_program: system_program::id(),
            rent: Rent::id(),
        }
        .instruction(InitializePoolV2InstructionArgs {
            initial_sqrt_price,
            tick_spacing,
        }),
    );

    initialization_cost += rent.minimum_balance(Whirlpool::LEN);
    initialization_cost += rent.minimum_balance(Account::LEN); // TODO: token 22 size
    initialization_cost += rent.minimum_balance(Account::LEN); // TODO: token 22 size

    let full_range = get_full_range_tick_indexes(tick_spacing);
    let lower_tick_index =
        get_tick_array_start_tick_index(full_range.tick_lower_index, tick_spacing);
    let upper_tick_index =
        get_tick_array_start_tick_index(full_range.tick_upper_index, tick_spacing);
    let initial_tick_index = sqrt_price_to_tick_index(initial_sqrt_price);
    let current_tick_index = get_tick_array_start_tick_index(initial_tick_index, tick_spacing);

    let tick_array_indexes =
        HashSet::from([lower_tick_index, upper_tick_index, current_tick_index]);
    for start_tick_index in tick_array_indexes {
        let tick_array_address = get_tick_array_address(&pool_address, start_tick_index)?;
        instructions.push(
            InitializeTickArray {
                whirlpool: pool_address,
                tick_array: tick_array_address.0,
                funder,
                system_program: system_program::id(),
            }
            .instruction(InitializeTickArrayInstructionArgs { start_tick_index }),
        );
        initialization_cost += rent.minimum_balance(TickArray::LEN);
    }

    Ok(CreatePoolInstructions {
        instructions,
        initialization_cost,
        pool_address,
        additional_signers: vec![token_vault_a, token_vault_b],
    })
}
