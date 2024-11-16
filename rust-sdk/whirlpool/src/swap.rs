use std::{error::Error, iter::zip};

use orca_whirlpools_client::{
    get_oracle_address, get_tick_array_address, AccountsType, RemainingAccountsInfo,
    RemainingAccountsSlice, SwapV2, SwapV2InstructionArgs, TickArray, Whirlpool,
};
use orca_whirlpools_core::{
    get_tick_array_start_tick_index, swap_quote_by_input_token, swap_quote_by_output_token,
    ExactInSwapQuote, ExactOutSwapQuote, TickArrayFacade, TickFacade, TICK_ARRAY_SIZE,
};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    instruction::AccountMeta, instruction::Instruction, pubkey::Pubkey, signature::Keypair,
};

use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER, SLIPPAGE_TOLERANCE_BPS,
};

// TODO: transfer hooks

#[derive(Debug, Clone, PartialEq)]
pub enum SwapType {
    ExactIn,
    ExactOut,
}

#[derive(Debug, Clone)]
pub enum SwapQuote {
    ExactIn(ExactInSwapQuote),
    ExactOut(ExactOutSwapQuote),
}

#[derive(Debug)]
pub struct SwapInstructions {
    pub instructions: Vec<Instruction>,
    pub quote: SwapQuote,
    pub additional_signers: Vec<Keypair>,
}

fn uninitialized_tick_array(start_tick_index: i32) -> TickArrayFacade {
    TickArrayFacade {
        start_tick_index,
        ticks: [TickFacade::default(); TICK_ARRAY_SIZE],
    }
}

fn fetch_tick_arrays_or_default(
    rpc: &RpcClient,
    whirlpool_address: Pubkey,
    whirlpool: &Whirlpool,
) -> Result<[(Pubkey, TickArrayFacade); 5], Box<dyn Error>> {
    let tick_array_start_index =
        get_tick_array_start_tick_index(whirlpool.tick_current_index, whirlpool.tick_spacing);
    let offset = whirlpool.tick_spacing as i32 * TICK_ARRAY_SIZE as i32;

    let tick_array_indexes = [
        tick_array_start_index,
        tick_array_start_index + offset,
        tick_array_start_index + offset * 2,
        tick_array_start_index - offset,
        tick_array_start_index - offset * 2,
    ];

    let tick_array_addresses: Vec<Pubkey> = tick_array_indexes
        .iter()
        .map(|&x| get_tick_array_address(&whirlpool_address, x).map(|y| y.0))
        .collect::<Result<Vec<Pubkey>, _>>()?;

    let tick_array_infos = rpc.get_multiple_accounts(&tick_array_addresses)?;

    let maybe_tick_arrays: Vec<Option<TickArrayFacade>> = tick_array_infos
        .iter()
        .map(|x| x.as_ref().and_then(|y| TickArray::from_bytes(&y.data).ok()))
        .map(|x| x.map(|y| y.into()))
        .collect();

    let tick_arrays: Vec<TickArrayFacade> = maybe_tick_arrays
        .iter()
        .enumerate()
        .map(|(i, x)| x.unwrap_or(uninitialized_tick_array(tick_array_indexes[i])))
        .collect::<Vec<TickArrayFacade>>();

    let result: [(Pubkey, TickArrayFacade); 5] = zip(tick_array_addresses, tick_arrays)
        .collect::<Vec<(Pubkey, TickArrayFacade)>>()
        .try_into()
        .map_err(|_| "Failed to convert tick arrays to array".to_string())?;

    Ok(result)
}

pub fn swap_instructions(
    rpc: &RpcClient,
    whirlpool_address: Pubkey,
    amount: u64,
    specified_mint: Pubkey,
    swap_type: SwapType,
    slippage_tolerance_bps: Option<u16>,
    signer: Option<Pubkey>,
) -> Result<SwapInstructions, Box<dyn Error>> {
    let slippage_tolerance_bps =
        slippage_tolerance_bps.unwrap_or(*SLIPPAGE_TOLERANCE_BPS.try_lock()?);
    let signer = signer.unwrap_or(*FUNDER.try_lock()?);
    if signer == Pubkey::default() {
        return Err("Signer must be provided".into());
    }

    let whirlpool_info = rpc.get_account(&whirlpool_address)?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    let specified_input = swap_type == SwapType::ExactIn;
    let specified_token_a = specified_mint == whirlpool.token_mint_a;
    let a_to_b = specified_token_a == specified_input;

    let tick_arrays = fetch_tick_arrays_or_default(rpc, whirlpool_address, &whirlpool)?;

    let mint_infos =
        rpc.get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or(format!("Mint a not found: {}", whirlpool.token_mint_a))?;

    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or(format!("Mint b not found: {}", whirlpool.token_mint_b))?;

    let oracle_address = get_oracle_address(&whirlpool_address)?.0;

    let current_epoch = rpc.get_epoch_info()?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let quote = match swap_type {
        SwapType::ExactIn => SwapQuote::ExactIn(swap_quote_by_input_token(
            amount,
            specified_token_a,
            slippage_tolerance_bps,
            whirlpool.clone().into(),
            tick_arrays.map(|x| x.1).into(),
            transfer_fee_a,
            transfer_fee_b,
        )?),
        SwapType::ExactOut => SwapQuote::ExactOut(swap_quote_by_output_token(
            amount,
            specified_token_a,
            slippage_tolerance_bps,
            whirlpool.clone().into(),
            tick_arrays.map(|x| x.1).into(),
            transfer_fee_a,
            transfer_fee_b,
        )?),
    };

    let max_in_amount = match quote {
        SwapQuote::ExactIn(quote) => quote.token_in,
        SwapQuote::ExactOut(quote) => quote.token_max_in,
    };
    let token_a_spec = if a_to_b {
        TokenAccountStrategy::WithBalance(whirlpool.token_mint_a, max_in_amount)
    } else {
        TokenAccountStrategy::WithoutBalance(whirlpool.token_mint_a)
    };
    let token_b_spec = if a_to_b {
        TokenAccountStrategy::WithoutBalance(whirlpool.token_mint_b)
    } else {
        TokenAccountStrategy::WithBalance(whirlpool.token_mint_b, max_in_amount)
    };

    let mut instructions: Vec<Instruction> = Vec::new();

    let token_accounts =
        prepare_token_accounts_instructions(rpc, signer, vec![token_a_spec, token_b_spec])?;

    instructions.extend(token_accounts.create_instructions);

    let other_amount_threshold = match quote {
        SwapQuote::ExactIn(quote) => quote.token_min_out,
        SwapQuote::ExactOut(quote) => quote.token_max_in,
    };

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&whirlpool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&whirlpool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    let swap_instruction = SwapV2 {
        token_program_a: mint_a_info.owner,
        token_program_b: mint_b_info.owner,
        memo_program: spl_memo::ID,
        token_authority: signer,
        whirlpool: whirlpool_address,
        token_mint_a: whirlpool.token_mint_a,
        token_mint_b: whirlpool.token_mint_b,
        token_owner_account_a: *token_owner_account_a,
        token_vault_a: whirlpool.token_vault_a,
        token_owner_account_b: *token_owner_account_b,
        token_vault_b: whirlpool.token_vault_b,
        tick_array0: tick_arrays[0].0,
        tick_array1: tick_arrays[1].0,
        tick_array2: tick_arrays[2].0,
        oracle: oracle_address,
    }
    .instruction_with_remaining_accounts(
        SwapV2InstructionArgs {
            amount,
            other_amount_threshold,
            sqrt_price_limit: 0,
            amount_specified_is_input: specified_input,
            a_to_b,
            remaining_accounts_info: Some(RemainingAccountsInfo {
                slices: vec![RemainingAccountsSlice {
                    accounts_type: AccountsType::SupplementalTickArrays,
                    length: 2,
                }],
            }),
        },
        &[
            AccountMeta::new(tick_arrays[3].0, false),
            AccountMeta::new(tick_arrays[4].0, false),
        ],
    );

    instructions.push(swap_instruction);
    instructions.extend(token_accounts.cleanup_instructions);

    Ok(SwapInstructions {
        instructions,
        quote,
        additional_signers: token_accounts.additional_signers,
    })
}
