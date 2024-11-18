use std::error::Error;
use std::str::FromStr;

use orca_whirlpools_client::{
    get_position_address, get_tick_array_address, InitializeTickArray,
    InitializeTickArrayInstructionArgs, OpenPositionWithTokenExtensions,
    OpenPositionWithTokenExtensionsInstructionArgs, Position, TickArray, Whirlpool,
};
use orca_whirlpools_client::{IncreaseLiquidityV2, IncreaseLiquidityV2InstructionArgs};
use orca_whirlpools_core::{
    get_full_range_tick_indexes, get_initializable_tick_index, get_tick_array_start_tick_index,
    increase_liquidity_quote, increase_liquidity_quote_a, increase_liquidity_quote_b,
    order_tick_indexes, price_to_tick_index, IncreaseLiquidityQuote, TransferFee,
};
use solana_client::rpc_client::RpcClient;
use solana_sdk::account::Account;
use solana_sdk::program_pack::Pack;
use solana_sdk::signer::Signer;
use solana_sdk::{instruction::Instruction, pubkey::Pubkey, signature::Keypair};
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token_2022::state::Mint;

use crate::{get_rent, SPLASH_POOL_TICK_SPACING};
use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER, SLIPPAGE_TOLERANCE_BPS,
};

// TODO: support transfer hooks

fn get_increase_liquidity_quote(
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: u16,
    pool: &Whirlpool,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<IncreaseLiquidityQuote, Box<dyn Error>> {
    let result = match param {
        IncreaseLiquidityParam::TokenA(amount) => increase_liquidity_quote_a(
            amount,
            slippage_tolerance_bps,
            pool.sqrt_price,
            tick_lower_index,
            tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        ),
        IncreaseLiquidityParam::TokenB(amount) => increase_liquidity_quote_b(
            amount,
            slippage_tolerance_bps,
            pool.sqrt_price,
            tick_lower_index,
            tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        ),
        IncreaseLiquidityParam::Liquidity(amount) => increase_liquidity_quote(
            amount,
            slippage_tolerance_bps,
            pool.sqrt_price,
            tick_lower_index,
            tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        ),
    }?;
    Ok(result)
}

/// Represents the parameters for increasing liquidity in a position.
///
/// You must choose one of the variants (`TokenA`, `TokenB`, or `Liquidity`).
/// The SDK will calculate the remaining values based on the provided input.
///
/// # Variants
///
/// * `TokenA(u64)` - Specifies the amount of token A to add to the position.
/// * `TokenB(u64)` - Specifies the amount of token B to add to the position.
/// * `Liquidity(u128)` - Specifies the amount of liquidity to add to the position.
#[derive(Debug, Clone)]
pub enum IncreaseLiquidityParam {
    TokenA(u64),
    TokenB(u64),
    Liquidity(u128),
}

/// Represents the instructions and quote for increasing liquidity in a position.
///
/// This struct includes the necessary transaction instructions, as well as a detailed
/// quote describing the liquidity increase.
///
/// # Fields
///
/// * `quote` - The computed quote for increasing liquidity, including:
///   - `liquidity_delta` - The change in liquidity.
///   - `token_est_a` - The estimated amount of token A required.
///   - `token_est_b` - The estimated amount of token B required.
///   - `token_max_a` - The maximum allowable amount of token A based on slippage tolerance.
///   - `token_max_b` - The maximum allowable amount of token B based on slippage tolerance.
/// * `instructions` - A vector of `Instruction` objects required to execute the liquidity increase.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
#[derive(Debug)]
pub struct IncreaseLiquidityInstruction {
    pub quote: IncreaseLiquidityQuote,
    pub instructions: Vec<Instruction>,
    pub additional_signers: Vec<Keypair>,
}

/// Generates instructions to increase liquidity for an existing position.
///
/// This function computes the necessary quote and creates instructions to add liquidity
/// to an existing pool position, specified by the position's mint address.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching necessary accounts and pool data.
/// * `position_mint_address` - The public key of the NFT mint address representing the pool position.
/// * `param` - A variant of `IncreaseLiquidityParam` specifying the liquidity addition method (by Token A, Token B, or liquidity amount).
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `authority` - An optional public key of the account authorizing the liquidity addition. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `IncreaseLiquidityInstruction` on success:
///
/// * `quote` - The computed quote for increasing liquidity, including liquidity delta, token estimates, and maximum tokens based on slippage tolerance.
/// * `instructions` - A vector of `Instruction` objects required to execute the liquidity addition.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The `authority` account is invalid or missing.
/// - The position or token mint accounts are not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::{
///     increase_liquidity_instructions, WhirlpoolsConfigInput, set_whirlpools_config_address, IncreaseLiquidityParam
/// };
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let position_mint_address = Pubkey::from_str("POSITION_NFT_MINT_PUBKEY").unwrap();
/// let param = IncreaseLiquidityParam::TokenA(1_000_000);
/// let slippage_tolerance_bps = Some(100);
///
/// let result = increase_liquidity_instructions(
///     &rpc,
///     position_mint_address,
///     param,
///     slippage_tolerance_bps,
///     None, // SET GLOBAL FUNDER
/// ).unwrap();
///
/// println!("Liquidity Increase Quote: {:?}", result.quote);
/// println!("Number of Instructions: {}", result.instructions.len());
/// ```
pub fn increase_liquidity_instructions(
    rpc: &RpcClient,
    position_mint_address: Pubkey,
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    authority: Option<Pubkey>,
) -> Result<IncreaseLiquidityInstruction, Box<dyn Error>> {
    let slippage_tolerance_bps =
        slippage_tolerance_bps.unwrap_or(*SLIPPAGE_TOLERANCE_BPS.try_lock()?);
    let authority = authority.unwrap_or(*FUNDER.try_lock()?);
    if authority == Pubkey::default() {
        return Err("Authority must be provided".into());
    }

    let position_address = get_position_address(&position_mint_address)?.0;
    let position_info = rpc.get_account(&position_address)?;
    let position = Position::from_bytes(&position_info.data)?;

    let pool_info = rpc.get_account(&position.whirlpool)?;
    let pool = Whirlpool::from_bytes(&pool_info.data)?;

    let mint_infos =
        rpc.get_multiple_accounts(&[pool.token_mint_a, pool.token_mint_b, position_mint_address])?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or("Token B mint info not found")?;
    let position_mint_info = mint_infos[2]
        .as_ref()
        .ok_or("Position mint info not found")?;

    let current_epoch = rpc.get_epoch_info()?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let quote = get_increase_liquidity_quote(
        param,
        slippage_tolerance_bps,
        &pool,
        position.tick_lower_index,
        position.tick_upper_index,
        transfer_fee_a,
        transfer_fee_b,
    )?;

    let mut instructions: Vec<Instruction> = Vec::new();

    let lower_tick_array_start_index =
        get_tick_array_start_tick_index(position.tick_lower_index, pool.tick_spacing);
    let upper_tick_array_start_index =
        get_tick_array_start_tick_index(position.tick_upper_index, pool.tick_spacing);

    let position_token_account_address = get_associated_token_address_with_program_id(
        &authority,
        &position_mint_address,
        &position_mint_info.owner,
    );
    let lower_tick_array_address =
        get_tick_array_address(&position.whirlpool, lower_tick_array_start_index)?.0;
    let upper_tick_array_address =
        get_tick_array_address(&position.whirlpool, upper_tick_array_start_index)?.0;

    let token_accounts = prepare_token_accounts_instructions(
        rpc,
        authority,
        vec![
            TokenAccountStrategy::WithBalance(pool.token_mint_a, quote.token_max_a),
            TokenAccountStrategy::WithBalance(pool.token_mint_b, quote.token_max_b),
        ],
    )?;

    instructions.extend(token_accounts.create_instructions);

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&pool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&pool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    instructions.push(
        IncreaseLiquidityV2 {
            whirlpool: position.whirlpool,
            token_program_a: mint_a_info.owner,
            token_program_b: mint_b_info.owner,
            memo_program: spl_memo::ID,
            position_authority: authority,
            position: position_address,
            position_token_account: position_token_account_address,
            token_mint_a: pool.token_mint_a,
            token_mint_b: pool.token_mint_b,
            token_owner_account_a: *token_owner_account_a,
            token_owner_account_b: *token_owner_account_b,
            token_vault_a: pool.token_vault_a,
            token_vault_b: pool.token_vault_b,
            tick_array_lower: lower_tick_array_address,
            tick_array_upper: upper_tick_array_address,
        }
        .instruction(IncreaseLiquidityV2InstructionArgs {
            liquidity_amount: quote.liquidity_delta,
            token_max_a: quote.token_max_a,
            token_max_b: quote.token_max_b,
            remaining_accounts_info: None,
        }),
    );

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(IncreaseLiquidityInstruction {
        quote,
        instructions,
        additional_signers: token_accounts.additional_signers,
    })
}

/// Represents the instructions and quote for opening a liquidity position.
///
/// This struct contains the instructions required to open a new position, along with detailed
/// information about the liquidity increase, the cost of initialization, and the mint address
/// of the position NFT.
///
/// # Fields
///
/// * `position_mint` - The public key of the position NFT that represents ownership of the newly opened position.
/// * `quote` - The computed quote for increasing liquidity, including liquidity delta, token estimates, and maximum tokens based on slippage tolerance.
/// * `instructions` - A vector of `Instruction` objects required to execute the position opening.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
/// * `initialization_cost` - The cost of initializing the position, measured in lamports.
#[derive(Debug)]
pub struct OpenPositionInstruction {
    pub position_mint: Pubkey,
    pub quote: IncreaseLiquidityQuote,
    pub instructions: Vec<Instruction>,
    pub additional_signers: Vec<Keypair>,
    pub initialization_cost: u64,
}

fn internal_open_position(
    rpc: &RpcClient,
    pool_address: Pubkey,
    whirlpool: Whirlpool,
    param: IncreaseLiquidityParam,
    lower_tick_index: i32,
    upper_tick_index: i32,
    mint_a_info: &Account,
    mint_b_info: &Account,
    slippage_tolerance_bps: Option<u16>,
    funder: Option<Pubkey>,
) -> Result<OpenPositionInstruction, Box<dyn Error>> {
    let funder = funder.unwrap_or(*FUNDER.try_lock()?);
    let slippage_tolerance_bps =
        slippage_tolerance_bps.unwrap_or(*SLIPPAGE_TOLERANCE_BPS.try_lock()?);
    let rent = get_rent()?;
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }

    let tick_range = order_tick_indexes(lower_tick_index, upper_tick_index);

    let lower_initializable_tick_index = get_initializable_tick_index(
        tick_range.tick_lower_index,
        whirlpool.tick_spacing,
        Some(false),
    );

    let upper_initializable_tick_index = get_initializable_tick_index(
        tick_range.tick_upper_index,
        whirlpool.tick_spacing,
        Some(true),
    );

    let mut instructions: Vec<Instruction> = Vec::new();
    let mut non_refundable_rent: u64 = 0;
    let mut additional_signers: Vec<Keypair> = Vec::new();

    let epoch = rpc.get_epoch_info()?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), epoch);

    let quote = get_increase_liquidity_quote(
        param,
        slippage_tolerance_bps,
        &whirlpool,
        lower_initializable_tick_index,
        upper_initializable_tick_index,
        transfer_fee_a,
        transfer_fee_b,
    )?;

    additional_signers.push(Keypair::new());
    let position_mint = additional_signers[0].pubkey();

    let lower_tick_start_index =
        get_tick_array_start_tick_index(lower_initializable_tick_index, whirlpool.tick_spacing);
    let upper_tick_start_index =
        get_tick_array_start_tick_index(upper_initializable_tick_index, whirlpool.tick_spacing);

    let position_address = get_position_address(&position_mint)?.0;
    let position_token_account_address =
        get_associated_token_address_with_program_id(&funder, &position_mint, &spl_token_2022::ID);
    let lower_tick_array_address = get_tick_array_address(&pool_address, lower_tick_start_index)?.0;
    let upper_tick_array_address = get_tick_array_address(&pool_address, upper_tick_start_index)?.0;

    let token_accounts = prepare_token_accounts_instructions(
        rpc,
        funder,
        vec![
            TokenAccountStrategy::WithBalance(whirlpool.token_mint_a, quote.token_max_a),
            TokenAccountStrategy::WithBalance(whirlpool.token_mint_b, quote.token_max_b),
        ],
    )?;

    instructions.extend(token_accounts.create_instructions);
    additional_signers.extend(token_accounts.additional_signers);

    let tick_array_infos =
        rpc.get_multiple_accounts(&[lower_tick_array_address, upper_tick_array_address])?;

    if tick_array_infos[0].is_none() {
        instructions.push(
            InitializeTickArray {
                whirlpool: pool_address,
                funder,
                tick_array: lower_tick_array_address,
                system_program: solana_sdk::system_program::id(),
            }
            .instruction(InitializeTickArrayInstructionArgs {
                start_tick_index: lower_tick_start_index,
            }),
        );
        non_refundable_rent += rent.minimum_balance(TickArray::LEN);
    }

    if tick_array_infos[1].is_none() {
        instructions.push(
            InitializeTickArray {
                whirlpool: pool_address,
                funder,
                tick_array: upper_tick_array_address,
                system_program: solana_sdk::system_program::id(),
            }
            .instruction(InitializeTickArrayInstructionArgs {
                start_tick_index: upper_tick_start_index,
            }),
        );
        non_refundable_rent += rent.minimum_balance(TickArray::LEN);
    }

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&whirlpool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&whirlpool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    instructions.push(
        OpenPositionWithTokenExtensions {
            funder,
            owner: funder,
            position: position_address,
            position_mint,
            position_token_account: position_token_account_address,
            whirlpool: pool_address,
            token2022_program: spl_token_2022::ID,
            system_program: solana_sdk::system_program::id(),
            associated_token_program: spl_associated_token_account::ID,
            metadata_update_auth: Pubkey::from_str("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr")?,
        }
        .instruction(OpenPositionWithTokenExtensionsInstructionArgs {
            tick_lower_index: lower_initializable_tick_index,
            tick_upper_index: upper_initializable_tick_index,
            with_token_metadata_extension: true,
        }),
    );

    instructions.push(
        IncreaseLiquidityV2 {
            whirlpool: pool_address,
            token_program_a: mint_a_info.owner,
            token_program_b: mint_b_info.owner,
            memo_program: spl_memo::ID,
            position_authority: funder,
            position: position_address,
            position_token_account: position_token_account_address,
            token_mint_a: whirlpool.token_mint_a,
            token_mint_b: whirlpool.token_mint_b,
            token_owner_account_a: *token_owner_account_a,
            token_owner_account_b: *token_owner_account_b,
            token_vault_a: whirlpool.token_vault_a,
            token_vault_b: whirlpool.token_vault_b,
            tick_array_lower: lower_tick_array_address,
            tick_array_upper: upper_tick_array_address,
        }
        .instruction(IncreaseLiquidityV2InstructionArgs {
            liquidity_amount: quote.liquidity_delta,
            token_max_a: quote.token_max_a,
            token_max_b: quote.token_max_b,
            remaining_accounts_info: None,
        }),
    );

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(OpenPositionInstruction {
        position_mint,
        quote,
        instructions,
        additional_signers,
        initialization_cost: non_refundable_rent,
    })
}

/// Opens a full-range position in a liquidity pool.
///
/// This function creates a new position within the full price range for the specified pool,
/// which is ideal for full-range liquidity provisioning, such as in Splash Pools.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `pool_address` - The public key of the liquidity pool.
/// * `param` - Parameters for increasing liquidity, specified as `IncreaseLiquidityParam`.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `funder` - An optional public key of the funder account. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenPositionInstruction` on success, which includes:
/// * `position_mint` - The mint address of the position NFT.
/// * `quote` - The computed liquidity quote, including liquidity delta, token estimates, and maximum tokens.
/// * `instructions` - A vector of `Instruction` objects required for creating the position.
/// * `additional_signers` - A vector of `Keypair` objects for additional transaction signers.
/// * `initialization_cost` - The cost of initializing the position, in lamports.
///
/// # Errors
///
/// Returns an error if:
/// - The funder account is invalid.
/// - The pool or token mint accounts are not found or invalid.
/// - Any RPC request fails.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::{pubkey::Pubkey, signer::Keypair};
/// use orca_whirlpools::{open_full_range_position_instructions, IncreaseLiquidityParam};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let whirlpool_pubkey = Pubkey::from_str("WHIRLPOOL_ADDRESS").unwrap();;
/// let param = IncreaseLiquidityParam::TokenA(1_000_000);
/// let slippage_tolerance_bps = Some(100);
///
/// let wallet = Keypair::new();
/// let funder = Some(wallet.pubkey());
///
/// let result = open_full_range_position_instructions(
///     &rpc,
///     whirlpool_pubkey,
///     param,
///     slippage_tolerance_bps,
///     funder,
/// ).unwrap();
///
/// println!("Position Mint: {:?}", result.position_mint);
/// println!("Initialization Cost: {} lamports", result.initialization_cost);
/// ```
pub fn open_full_range_position_instructions(
    rpc: &RpcClient,
    pool_address: Pubkey,
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    funder: Option<Pubkey>,
) -> Result<OpenPositionInstruction, Box<dyn Error>> {
    let whirlpool_info = rpc.get_account(&pool_address)?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    let tick_range = get_full_range_tick_indexes(whirlpool.tick_spacing);
    let mint_infos =
        rpc.get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])?;
    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or("Token B mint info not found")?;
    internal_open_position(
        rpc,
        pool_address,
        whirlpool,
        param,
        tick_range.tick_lower_index,
        tick_range.tick_upper_index,
        mint_a_info,
        mint_b_info,
        slippage_tolerance_bps,
        funder,
    )
}

/// Opens a position in a liquidity pool within a specific price range.
///
/// This function creates a new position in the specified price range for a given pool. 
/// It allows for providing liquidity in a targeted range, optimizing capital efficiency.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `pool_address` - The public key of the liquidity pool.
/// * `lower_price` - The lower bound of the price range for the position.
/// * `upper_price` - The upper bound of the price range for the position.
/// * `param` - Parameters for increasing liquidity, specified as `IncreaseLiquidityParam`.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `funder` - An optional public key of the funder account. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenPositionInstruction` on success, which includes:
/// * `position_mint` - The mint address of the position NFT.
/// * `quote` - The computed liquidity quote, including liquidity delta, token estimates, and maximum tokens.
/// * `instructions` - A vector of `Instruction` objects required for creating the position.
/// * `additional_signers` - A vector of `Keypair` objects for additional transaction signers.
/// * `initialization_cost` - The cost of initializing the position, in lamports.
///
/// # Errors
///
/// Returns an error if:
/// - The funder account is invalid.
/// - The pool or token mint accounts are not found or invalid.
/// - Any RPC request fails.
/// - The pool is a Splash Pool, as they only support full-range positions.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::{pubkey::Pubkey, signer::Keypair};
/// use orca_whirlpools::{open_position_instructions, IncreaseLiquidityParam};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let whirlpool_pubkey = Pubkey::from_str("WHIRLPOOL_ADDRESS").unwrap();
/// let lower_price = 0.00005;
/// let upper_price = 0.00015;
/// let param = IncreaseLiquidityParam::TokenA(1_000_000);
/// let slippage_tolerance_bps = Some(100);
///
/// let wallet = Keypair::new();
/// let funder = Some(wallet.pubkey());
///
/// let result = open_position_instructions(
///     &rpc,
///     whirlpool_pubkey,
///     lower_price,
///     upper_price,
///     param,
///     slippage_tolerance_bps,
///     funder,
/// ).unwrap();
///
/// println!("Position Mint: {:?}", result.position_mint);
/// println!("Initialization Cost: {} lamports", result.initialization_cost);
/// ```
pub fn open_position_instructions(
    rpc: &RpcClient,
    pool_address: Pubkey,
    lower_price: f64,
    upper_price: f64,
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    funder: Option<Pubkey>,
) -> Result<OpenPositionInstruction, Box<dyn Error>> {
    let whirlpool_info = rpc.get_account(&pool_address)?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    if whirlpool.tick_spacing == SPLASH_POOL_TICK_SPACING {
        return Err("Splash pools only support full range positions".into());
    }
    let mint_infos =
        rpc.get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])?;
    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or("Token A mint info not found")?;
    let mint_a = Mint::unpack(&mint_a_info.data)?;
    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or("Token B mint info not found")?;
    let mint_b = Mint::unpack(&mint_b_info.data)?;

    let decimals_a = mint_a.decimals;
    let decimals_b = mint_b.decimals;

    let lower_tick_index = price_to_tick_index(lower_price, decimals_a, decimals_b);
    let upper_tick_index = price_to_tick_index(upper_price, decimals_a, decimals_b);

    internal_open_position(
        rpc,
        pool_address,
        whirlpool,
        param,
        lower_tick_index,
        upper_tick_index,
        mint_a_info,
        mint_b_info,
        slippage_tolerance_bps,
        funder,
    )
}
