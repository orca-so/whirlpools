use std::{error::Error, iter::zip};

use orca_whirlpools_client::{
    get_oracle_address, get_tick_array_address, AccountsType, RemainingAccountsInfo,
    RemainingAccountsSlice, SwapV2, SwapV2InstructionArgs, TickArray, Whirlpool,
};
use orca_whirlpools_core::{
    get_tick_array_start_tick_index, swap_quote_by_input_token, swap_quote_by_output_token,
    ExactInSwapQuote, ExactOutSwapQuote, TickArrayFacade, TickFacade, TICK_ARRAY_SIZE,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::AccountMeta, instruction::Instruction, pubkey::Pubkey, signature::Keypair,
};

use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER, SLIPPAGE_TOLERANCE_BPS,
};

// TODO: transfer hooks

/// Represents the type of a swap operation.
///
/// This enum is used to specify whether the swap is an exact input or exact output type.
#[derive(Debug, Clone, PartialEq)]
pub enum SwapType {
    /// Indicates a swap where the input token amount is specified.
    ExactIn,

    /// Indicates a swap where the output token amount is specified.
    ExactOut,
}

/// Represents the quote for a swap operation.
///
/// This enum contains the details of the swap quote based on the type of swap.
#[derive(Debug, Clone)]
pub enum SwapQuote {
    /// The quote for a swap with a specified input token amount.
    ExactIn(ExactInSwapQuote),

    /// The quote for a swap with a specified output token amount.
    ExactOut(ExactOutSwapQuote),
}

/// Represents the instructions and quote for executing a token swap.
///
/// This struct contains the instructions required to perform the swap, along with the computed
/// quote and any additional signers required.
#[derive(Debug)]
pub struct SwapInstructions {
    /// A vector of Solana `Instruction` objects required to execute the swap.
    pub instructions: Vec<Instruction>,

    /// A `SwapQuote` representing the details of the swap.
    pub quote: SwapQuote,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,
}

fn uninitialized_tick_array(start_tick_index: i32) -> TickArrayFacade {
    TickArrayFacade {
        start_tick_index,
        ticks: [TickFacade::default(); TICK_ARRAY_SIZE],
    }
}

async fn fetch_tick_arrays_or_default(
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

    let tick_array_infos = rpc.get_multiple_accounts(&tick_array_addresses).await?;

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

/// Generates the instructions necessary to execute a token swap.
///
/// This function generates instructions for executing swaps, supporting both exact input and exact output scenarios.
/// It calculates the necessary accounts, tick arrays, and swap quote using the provided parameters.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client for fetching accounts and interacting with the blockchain.
/// * `whirlpool_address` - The public key of the Whirlpool against which the swap will be executed.
/// * `amount` - The token amount specified for the swap. For `SwapType::ExactIn`, this is the input token amount.
///              For `SwapType::ExactOut`, this is the output token amount.
/// * `specified_mint` - The public key of the token mint being swapped.
/// * `swap_type` - The type of swap (`SwapType::ExactIn` or `SwapType::ExactOut`).
/// * `slippage_tolerance_bps` - An optional slippage tolerance, in basis points (BPS). Defaults to the global setting if not provided.
/// * `signer` - An optional public key of the wallet or account executing the swap. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `SwapInstructions` on success:
/// * `instructions` - A vector of `Instruction` objects required to execute the swap.
/// * `quote` - A `SwapQuote` providing the computed details of the swap.
/// * `additional_signers` - A vector of `Keypair` objects representing any additional signers required for the instructions.
///
/// # Errors
///
/// Returns an error if:
/// - The signer is invalid or missing.
/// - The Whirlpool or token mint accounts are not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools_sdk::{
///     swap_instructions, SwapType, set_whirlpools_config_address, WhirlpoolsConfigInput,
/// };
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let whirlpool_pubkey = Pubkey::from_str("WHIRLPOOL_ADDRESS").unwrap();
/// let amount = 1_000_000; // Amount to swap.
/// let specified_mint = Pubkey::from_str("SPECIFIED_MINT_ADDRESS").unwrap();
/// let slippage_tolerance_bps = Some(100);
///
/// let swap_instructions = swap_instructions(
///     &rpc,
///     whirlpool_pubkey,
///     amount,
///     specified_mint,
///     SwapType::ExactIn,
///     slippage_tolerance_bps,
///     None,
/// ).unwrap();
///
/// println!("Number of Instructions: {}", swap_instructions.instructions.len());
/// println!("Swap Quote: {:?}", swap_instructions.quote);
/// ```
pub async fn swap_instructions(
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

    let whirlpool_info = rpc.get_account(&whirlpool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    let specified_input = swap_type == SwapType::ExactIn;
    let specified_token_a = specified_mint == whirlpool.token_mint_a;
    let a_to_b = specified_token_a == specified_input;

    let tick_arrays = fetch_tick_arrays_or_default(rpc, whirlpool_address, &whirlpool).await?;

    let mint_infos = rpc
        .get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])
        .await?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or(format!("Mint a not found: {}", whirlpool.token_mint_a))?;

    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or(format!("Mint b not found: {}", whirlpool.token_mint_b))?;

    let oracle_address = get_oracle_address(&whirlpool_address)?.0;

    let current_epoch = rpc.get_epoch_info().await?.epoch;
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
        prepare_token_accounts_instructions(rpc, signer, vec![token_a_spec, token_b_spec]).await?;

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
