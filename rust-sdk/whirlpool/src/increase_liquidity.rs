use std::error::Error;
use std::str::FromStr;

use orca_whirlpools_client::{
    get_position_address, get_tick_array_address, DynamicTickArray, InitializeDynamicTickArray,
    InitializeDynamicTickArrayInstructionArgs, OpenPositionWithTokenExtensions,
    OpenPositionWithTokenExtensionsInstructionArgs, Position, Whirlpool,
};
use orca_whirlpools_client::{
    IncreaseLiquidityByTokenAmountsV2, IncreaseLiquidityByTokenAmountsV2InstructionArgs,
    IncreaseLiquidityMethod as IncreaseLiquidityInstructionMethod,
};
use orca_whirlpools_core::{
    get_full_range_tick_indexes, get_initializable_tick_index, get_tick_array_start_tick_index,
    is_tick_index_in_bounds, is_tick_initializable, order_tick_indexes, price_to_tick_index,
    BPS_DENOMINATOR, MAX_SQRT_PRICE, MIN_SQRT_PRICE,
};
use solana_account::Account;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_instruction::Instruction;
use solana_keypair::{Keypair, Signer};
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;
use spl_token_2022_interface::state::Mint;

use crate::{get_rent, SPLASH_POOL_TICK_SPACING};
use crate::{
    token::{prepare_token_accounts_instructions, TokenAccountInstructions, TokenAccountStrategy},
    FUNDER, SLIPPAGE_TOLERANCE_BPS,
};

// TODO: support transfer hooks

/// Scaling factor for sqrt-price slippage. Factor values are in hundredths (e.g. 99.5 → 9950),
/// so we divide by 100 to get the effective multiplier.
const SQRT_SLIPPAGE_DENOMINATOR: u128 = 100;

/// Integer square root using Newton's method (floor of sqrt).
fn sqrt_u128(value: u128) -> u128 {
    if value < 2 {
        return value;
    }
    let mut prev = value / 2;
    let mut next = (prev + value / prev) / 2;
    while next < prev {
        prev = next;
        next = (prev + value / prev) / 2;
    }
    prev
}

/// Computes min/max sqrt-price bounds for slippage protection.
///
/// Cap: `slippage_tolerance_bps` is clamped to BPS_DENOMINATOR (10_000) so the radicands
/// `(10000 ± bps)` stay non-negative and we never take sqrt of a negative.
fn get_sqrt_price_slippage_bounds(sqrt_price: u128, slippage_tolerance_bps: u16) -> (u128, u128) {
    let capped_bps = slippage_tolerance_bps.min(BPS_DENOMINATOR);
    let bps = u128::from(capped_bps);
    let bps_denominator = u128::from(BPS_DENOMINATOR);
    let lower_factor = sqrt_u128(bps_denominator - bps);
    let upper_factor = sqrt_u128(bps_denominator + bps);

    let scale = |factor: u128| sqrt_price.saturating_mul(factor) / SQRT_SLIPPAGE_DENOMINATOR;
    let min_sqrt_price = scale(lower_factor).max(MIN_SQRT_PRICE);
    let max_sqrt_price = scale(upper_factor).min(MAX_SQRT_PRICE);
    (min_sqrt_price, max_sqrt_price)
}

/// Represents the token max amount parameters for increasing liquidity.
#[derive(Debug, Clone)]
pub struct IncreaseLiquidityParam {
    pub token_max_a: u64,
    pub token_max_b: u64,
}

struct GetIncreaseLiquidityInstructionsParams<'a> {
    whirlpool_address: Pubkey,
    whirlpool: &'a Whirlpool,
    position_address: Pubkey,
    position_token_account_address: Pubkey,
    tick_array_lower_address: Pubkey,
    tick_array_upper_address: Pubkey,
    mint_a_info: &'a Account,
    mint_b_info: &'a Account,
    param: &'a IncreaseLiquidityParam,
    authority: Pubkey,
    slippage_tolerance_bps: u16,
}

struct GetIncreaseLiquidityInstructionsResult {
    token_accounts: TokenAccountInstructions,
    increase_liquidity_instruction: Instruction,
}

/// Builds token account setup, increase liquidity, and cleanup instructions from token max amounts
/// and position parameters. Shared by both `increase_liquidity_instructions` and `internal_open_position`.
async fn get_increase_liquidity_instructions(
    rpc: &RpcClient,
    params: GetIncreaseLiquidityInstructionsParams<'_>,
) -> Result<GetIncreaseLiquidityInstructionsResult, Box<dyn Error>> {
    let token_accounts = prepare_token_accounts_instructions(
        rpc,
        params.authority,
        vec![
            TokenAccountStrategy::WithBalance(
                params.whirlpool.token_mint_a,
                params.param.token_max_a,
            ),
            TokenAccountStrategy::WithBalance(
                params.whirlpool.token_mint_b,
                params.param.token_max_b,
            ),
        ],
    )
    .await?;

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&params.whirlpool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&params.whirlpool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    let (min_sqrt_price, max_sqrt_price) =
        get_sqrt_price_slippage_bounds(params.whirlpool.sqrt_price, params.slippage_tolerance_bps);

    let increase_liquidity_instruction = IncreaseLiquidityByTokenAmountsV2 {
        whirlpool: params.whirlpool_address,
        token_program_a: params.mint_a_info.owner,
        token_program_b: params.mint_b_info.owner,
        memo_program: spl_memo_interface::v3::ID,
        position_authority: params.authority,
        position: params.position_address,
        position_token_account: params.position_token_account_address,
        token_mint_a: params.whirlpool.token_mint_a,
        token_mint_b: params.whirlpool.token_mint_b,
        token_owner_account_a: *token_owner_account_a,
        token_owner_account_b: *token_owner_account_b,
        token_vault_a: params.whirlpool.token_vault_a,
        token_vault_b: params.whirlpool.token_vault_b,
        tick_array_lower: params.tick_array_lower_address,
        tick_array_upper: params.tick_array_upper_address,
    }
    .instruction(IncreaseLiquidityByTokenAmountsV2InstructionArgs {
        method: IncreaseLiquidityInstructionMethod::ByTokenAmounts {
            token_max_a: params.param.token_max_a,
            token_max_b: params.param.token_max_b,
            min_sqrt_price,
            max_sqrt_price,
        },
        remaining_accounts_info: None,
    });

    Ok(GetIncreaseLiquidityInstructionsResult {
        token_accounts,
        increase_liquidity_instruction,
    })
}

/// Represents the instructions for increasing liquidity in a position.
///
/// This struct includes the necessary transaction instructions to add liquidity
/// to an existing position.
#[derive(Debug)]
pub struct IncreaseLiquidityInstruction {
    /// A vector of `Instruction` objects required to execute the liquidity increase.
    pub instructions: Vec<Instruction>,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,
}

/// Generates instructions to increase liquidity for an existing position.
///
/// This function creates instructions to add liquidity to an existing pool position,
/// specified by the position's mint address, using the provided token max amounts.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching necessary accounts and pool data.
/// * `position_mint_address` - The public key of the NFT mint address representing the pool position.
/// * `param` - Maximum amounts of token A and B to deposit. The program will use
///   the minimum liquidity achievable within these caps.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `authority` - An optional public key of the account authorizing the liquidity addition. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `IncreaseLiquidityInstruction` on success:
///
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
/// use orca_whirlpools::{
///     increase_liquidity_instructions, set_whirlpools_config_address,
///     IncreaseLiquidityParam, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_pubkey::Pubkey;
/// use std::str::FromStr;
/// use crate::utils::load_wallet;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let wallet = load_wallet();
///     let position_mint_address = Pubkey::from_str("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K").unwrap();
///     let param = IncreaseLiquidityParam { token_max_a: 1_000_000, token_max_b: 1_000_000 };
///
///     let result = increase_liquidity_instructions(
///         &rpc,
///         position_mint_address,
///         param,
///         Some(100),
///         Some(wallet.pubkey()),
///     )
///     .await.unwrap();
///
///     println!("Number of Instructions: {}", result.instructions.len());
/// }
/// ```
pub async fn increase_liquidity_instructions(
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
    let position_info = rpc.get_account(&position_address).await?;
    let position = Position::from_bytes(&position_info.data)?;

    let pool_info = rpc.get_account(&position.whirlpool).await?;
    let pool = Whirlpool::from_bytes(&pool_info.data)?;

    let mint_infos = rpc
        .get_multiple_accounts(&[pool.token_mint_a, pool.token_mint_b, position_mint_address])
        .await?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or("Token B mint info not found")?;
    let position_mint_info = mint_infos[2]
        .as_ref()
        .ok_or("Position mint info not found")?;

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

    let GetIncreaseLiquidityInstructionsResult {
        token_accounts,
        increase_liquidity_instruction,
    } = get_increase_liquidity_instructions(
        rpc,
        GetIncreaseLiquidityInstructionsParams {
            whirlpool_address: position.whirlpool,
            whirlpool: &pool,
            position_address,
            position_token_account_address,
            tick_array_lower_address: lower_tick_array_address,
            tick_array_upper_address: upper_tick_array_address,
            mint_a_info,
            mint_b_info,
            authority,
            slippage_tolerance_bps,
            param: &param,
        },
    )
    .await?;

    let mut instructions: Vec<Instruction> = Vec::new();
    instructions.extend(token_accounts.create_instructions);
    instructions.push(increase_liquidity_instruction);
    instructions.extend(token_accounts.cleanup_instructions);

    Ok(IncreaseLiquidityInstruction {
        instructions,
        additional_signers: token_accounts.additional_signers,
    })
}

/// Represents the instructions for opening a liquidity position.
///
/// This struct contains the instructions required to open a new position, the cost of
/// initialization, and the mint address of the position NFT.
#[derive(Debug)]
pub struct OpenPositionInstruction {
    /// The public key of the position NFT that represents ownership of the newly opened position.
    pub position_mint: Pubkey,

    /// A vector of `Instruction` objects required to execute the position opening.
    pub instructions: Vec<Instruction>,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,

    /// The cost of initializing the position, measured in lamports.
    pub initialization_cost: u64,
}

#[allow(clippy::too_many_arguments)]
async fn internal_open_position(
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
    let rent = get_rent(rpc).await?;
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

    additional_signers.push(Keypair::new());
    let position_mint = additional_signers[0].pubkey();

    let lower_tick_start_index =
        get_tick_array_start_tick_index(lower_initializable_tick_index, whirlpool.tick_spacing);
    let upper_tick_start_index =
        get_tick_array_start_tick_index(upper_initializable_tick_index, whirlpool.tick_spacing);

    let position_address = get_position_address(&position_mint)?.0;
    let position_token_account_address = get_associated_token_address_with_program_id(
        &funder,
        &position_mint,
        &spl_token_2022_interface::ID,
    );
    let lower_tick_array_address = get_tick_array_address(&pool_address, lower_tick_start_index)?.0;
    let upper_tick_array_address = get_tick_array_address(&pool_address, upper_tick_start_index)?.0;

    let GetIncreaseLiquidityInstructionsResult {
        token_accounts,
        increase_liquidity_instruction,
    } = get_increase_liquidity_instructions(
        rpc,
        GetIncreaseLiquidityInstructionsParams {
            whirlpool_address: pool_address,
            whirlpool: &whirlpool,
            position_address,
            position_token_account_address,
            tick_array_lower_address: lower_tick_array_address,
            tick_array_upper_address: upper_tick_array_address,
            mint_a_info,
            mint_b_info,
            authority: funder,
            slippage_tolerance_bps,
            param: &param,
        },
    )
    .await?;

    instructions.extend(token_accounts.create_instructions);
    additional_signers.extend(token_accounts.additional_signers);

    let tick_array_infos = rpc
        .get_multiple_accounts(&[lower_tick_array_address, upper_tick_array_address])
        .await?;

    if tick_array_infos[0].is_none() {
        instructions.push(
            InitializeDynamicTickArray {
                whirlpool: pool_address,
                funder,
                tick_array: lower_tick_array_address,
                system_program: solana_system_interface::program::id(),
            }
            .instruction(InitializeDynamicTickArrayInstructionArgs {
                start_tick_index: lower_tick_start_index,
                idempotent: false,
            }),
        );
        non_refundable_rent += rent.minimum_balance(DynamicTickArray::MIN_LEN);
    }

    if tick_array_infos[1].is_none() && lower_tick_start_index != upper_tick_start_index {
        instructions.push(
            InitializeDynamicTickArray {
                whirlpool: pool_address,
                funder,
                tick_array: upper_tick_array_address,
                system_program: solana_system_interface::program::id(),
            }
            .instruction(InitializeDynamicTickArrayInstructionArgs {
                start_tick_index: upper_tick_start_index,
                idempotent: false,
            }),
        );
        non_refundable_rent += rent.minimum_balance(DynamicTickArray::MIN_LEN);
    }

    instructions.push(
        OpenPositionWithTokenExtensions {
            funder,
            owner: funder,
            position: position_address,
            position_mint,
            position_token_account: position_token_account_address,
            whirlpool: pool_address,
            token2022_program: spl_token_2022_interface::ID,
            system_program: solana_system_interface::program::id(),
            associated_token_program: spl_associated_token_account_interface::program::id(),
            metadata_update_auth: Pubkey::from_str("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr")?,
        }
        .instruction(OpenPositionWithTokenExtensionsInstructionArgs {
            tick_lower_index: lower_initializable_tick_index,
            tick_upper_index: upper_initializable_tick_index,
            with_token_metadata_extension: true,
        }),
    );

    instructions.push(increase_liquidity_instruction);
    instructions.extend(token_accounts.cleanup_instructions);

    Ok(OpenPositionInstruction {
        position_mint,
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
/// * `param` - Maximum amounts of token A and B to deposit.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `funder` - An optional public key of the funder account. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenPositionInstruction` on success, which includes:
/// * `position_mint` - The mint address of the position NFT.
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
/// use solana_keypair::Keypair;
/// use solana_pubkey::Pubkey;
/// use orca_whirlpools::{open_full_range_position_instructions, IncreaseLiquidityParam};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let whirlpool_pubkey = Pubkey::from_str("WHIRLPOOL_ADDRESS").unwrap();
/// let param = IncreaseLiquidityParam { token_max_a: 1_000_000, token_max_b: 1_000_000 };
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
pub async fn open_full_range_position_instructions(
    rpc: &RpcClient,
    pool_address: Pubkey,
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    funder: Option<Pubkey>,
) -> Result<OpenPositionInstruction, Box<dyn Error>> {
    let whirlpool_info = rpc.get_account(&pool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    let tick_range = get_full_range_tick_indexes(whirlpool.tick_spacing);
    let mint_infos = rpc
        .get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])
        .await?;
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
    .await
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
/// * `lower_price` - The lower bound of the price range for the position. It returns error if the lower_price <= 0.0.
/// * `upper_price` - The upper bound of the price range for the position. It returns error if the upper_price <= 0.0.
/// * `param` - Maximum amounts of token A and B to deposit.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `funder` - An optional public key of the funder account. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenPositionInstruction` on success, which includes:
/// * `position_mint` - The mint address of the position NFT.
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
/// - The lower price is less or equal to 0.0.
/// - The upper price is less or equal to 0.0.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_keypair::Keypair;
/// use solana_pubkey::Pubkey;
/// use orca_whirlpools::{open_position_instructions, IncreaseLiquidityParam};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let whirlpool_pubkey = Pubkey::from_str("WHIRLPOOL_ADDRESS").unwrap();
/// let lower_price = 0.00005;
/// let upper_price = 0.00015;
/// let param = IncreaseLiquidityParam { token_max_a: 1_000_000, token_max_b: 1_000_000 };
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
pub async fn open_position_instructions(
    rpc: &RpcClient,
    pool_address: Pubkey,
    lower_price: f64,
    upper_price: f64,
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    funder: Option<Pubkey>,
) -> Result<OpenPositionInstruction, Box<dyn Error>> {
    if lower_price <= 0.0 || upper_price <= 0.0 {
        return Err("Floating price must be greater than 0.0".into());
    }
    let whirlpool_info = rpc.get_account(&pool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    if whirlpool.tick_spacing == SPLASH_POOL_TICK_SPACING {
        return Err("Splash pools only support full range positions".into());
    }
    let mint_infos = rpc
        .get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])
        .await?;
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
    .await
}

/// Opens a position in a liquidity pool using explicit tick-index bounds.
///
/// This function creates a new position for the specified pool using the provided
/// `lower_tick_index` and `upper_tick_index` bounds (instead of floating-point prices).
/// The tick indexes must be within Whirlpool's global bounds and aligned with the pool's
/// tick spacing.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `pool_address` - The public key of the liquidity pool.
/// * `lower_tick_index` - The lower tick bound for the position. It returns error if out of bounds or not aligned with tick spacing.
/// * `upper_tick_index` - The upper tick bound for the position. It returns error if out of bounds or not aligned with tick spacing.
/// * `param` - Maximum amounts of token A and B to deposit.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `funder` - An optional public key of the funder account. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenPositionInstruction` on success, which includes:
/// * `position_mint` - The mint address of the position NFT.
/// * `instructions` - A vector of `Instruction` objects required for creating the position.
/// * `additional_signers` - A vector of `Keypair` objects for additional transaction signers.
/// * `initialization_cost` - The cost of initializing the position, in lamports.
///
/// # Errors
///
/// Returns an error if:
/// - The pool or token mint accounts are not found or invalid.
/// - Any RPC request fails.
/// - The pool is a Splash Pool, as they only support full-range positions.
/// - `lower_tick_index` or `upper_tick_index` is out of bounds.
/// - `lower_tick_index` or `upper_tick_index` is not aligned with the pool's tick spacing.
/// - `lower_tick_index` is greater than or equal to `upper_tick_index`.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_keypair::Keypair;
/// use solana_pubkey::Pubkey;
/// use orca_whirlpools::{open_position_instructions_with_tick_bounds, IncreaseLiquidityParam};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let whirlpool_pubkey = Pubkey::from_str("WHIRLPOOL_ADDRESS").unwrap();
/// let lower_tick_index = -44320;
/// let upper_tick_index = -22160;
/// let para = IncreaseLiquidityParam{ token_max_a: 1_000_000, token_max_b: 1_000_000 };
/// let slippage_tolerance_bps = Some(100);
///
/// let wallet = Keypair::new();
/// let funder = Some(wallet.pubkey());
///
/// let result = open_position_instructions_with_tick_bounds(
///     &rpc,
///     whirlpool_pubkey,
///     lower_tick_index,
///     upper_tick_index,
///     para,
///     slippage_tolerance_bps,
///     funder,
/// ).unwrap();
///
/// println!("Position Mint: {:?}", result.position_mint);
/// println!("Initialization Cost: {} lamports", result.initialization_cost);
/// ```
pub async fn open_position_instructions_with_tick_bounds(
    rpc: &RpcClient,
    pool_address: Pubkey,
    lower_tick_index: i32,
    upper_tick_index: i32,
    param: IncreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    funder: Option<Pubkey>,
) -> Result<OpenPositionInstruction, Box<dyn Error>> {
    let whirlpool_info = rpc.get_account(&pool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    if whirlpool.tick_spacing == SPLASH_POOL_TICK_SPACING {
        return Err("Splash pools only support full range positions".into());
    }

    if !is_tick_index_in_bounds(lower_tick_index) {
        return Err("Lower tick index is out of bounds".into());
    }

    if !is_tick_initializable(lower_tick_index, whirlpool.tick_spacing) {
        return Err(format!(
            "Lower tick index {} is not aligned with tick spacing {}",
            lower_tick_index, whirlpool.tick_spacing
        )
        .into());
    }

    if !is_tick_index_in_bounds(upper_tick_index) {
        return Err("Upper tick index is out of bounds".into());
    }

    if !is_tick_initializable(upper_tick_index, whirlpool.tick_spacing) {
        return Err(format!(
            "Upper tick index {} is not aligned with tick spacing {}",
            upper_tick_index, whirlpool.tick_spacing
        )
        .into());
    }

    if lower_tick_index >= upper_tick_index {
        return Err(format!(
            "Lower tick index {} must be less than upper tick index {}",
            lower_tick_index, upper_tick_index
        )
        .into());
    }

    let mint_infos = rpc
        .get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])
        .await?;
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
        lower_tick_index,
        upper_tick_index,
        mint_a_info,
        mint_b_info,
        slippage_tolerance_bps,
        funder,
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::error::Error;

    use orca_whirlpools_client::{get_position_address, Position, Whirlpool};
    use orca_whirlpools_core::{
        increase_liquidity_quote_a, increase_liquidity_quote_b, IncreaseLiquidityQuote, TransferFee,
    };
    use rstest::rstest;
    use serial_test::serial;
    use solana_keypair::{Keypair, Signer};
    use solana_program_pack::Pack;

    use solana_pubkey::Pubkey;
    use spl_token_2022_interface::{
        extension::StateWithExtensionsOwned, state::Account as TokenAccount2022,
        ID as TOKEN_2022_PROGRAM_ID,
    };
    use spl_token_interface::state::Account as TokenAccount;

    use crate::{
        increase_liquidity_instructions, open_position_instructions,
        test_utils::assert_liquidity_close,
        tests::{
            setup_ata_te, setup_ata_with_amount, setup_mint_te, setup_mint_te_fee,
            setup_mint_with_decimals, setup_position, setup_whirlpool, RpcContext, SetupAtaConfig,
        },
        IncreaseLiquidityInstruction, IncreaseLiquidityParam,
    };

    use solana_client::nonblocking::rpc_client::RpcClient;

    const RELATIVE_TOLERANCE_BPS: u128 = 50;
    const MIN_ABSOLUTE_BPS: u128 = 2;

    async fn fetch_position(rpc: &RpcClient, address: Pubkey) -> Result<Position, Box<dyn Error>> {
        let account = rpc.get_account(&address).await?;
        Position::from_bytes(&account.data).map_err(|e| e.into())
    }

    async fn get_token_balance(rpc: &RpcClient, address: Pubkey) -> Result<u64, Box<dyn Error>> {
        let account_data = rpc.get_account(&address).await?;

        if account_data.owner == TOKEN_2022_PROGRAM_ID {
            let state = StateWithExtensionsOwned::<TokenAccount2022>::unpack(account_data.data)?;
            Ok(state.base.amount)
        } else {
            let token_account = TokenAccount::unpack(&account_data.data)?;
            Ok(token_account.amount)
        }
    }

    fn get_constraining_quote(
        param: &IncreaseLiquidityParam,
        slippage_tolerance_bps: u16,
        current_sqrt_price: u128,
        tick_lower_index: i32,
        tick_upper_index: i32,
        transfer_fee_a: Option<TransferFee>,
        transfer_fee_b: Option<TransferFee>,
    ) -> Result<IncreaseLiquidityQuote, Box<dyn Error>> {
        let quote_a = increase_liquidity_quote_a(
            param.token_max_a,
            slippage_tolerance_bps,
            current_sqrt_price,
            tick_lower_index,
            tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        )?;
        let quote_b = increase_liquidity_quote_b(
            param.token_max_b,
            slippage_tolerance_bps,
            current_sqrt_price,
            tick_lower_index,
            tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        )?;
        let liquidity_a = quote_a.liquidity_delta;
        let liquidity_b = quote_b.liquidity_delta;
        let quote = if liquidity_a == 0 {
            quote_b
        } else if liquidity_b == 0 {
            quote_a
        } else if liquidity_a <= liquidity_b {
            quote_a
        } else {
            quote_b
        };
        Ok(quote)
    }

    async fn verify_increase_liquidity(
        ctx: &RpcContext,
        increase_ix: &IncreaseLiquidityInstruction,
        token_a_account: Pubkey,
        token_b_account: Pubkey,
        position_mint: Pubkey,
        param: IncreaseLiquidityParam,
        pool_name: &str,
    ) -> Result<(), Box<dyn Error>> {
        let before_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let before_b = get_token_balance(&ctx.rpc, token_b_account).await?;

        let signers: Vec<&Keypair> = increase_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(increase_ix.instructions.clone(), signers)
            .await?;

        let after_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let after_b = get_token_balance(&ctx.rpc, token_b_account).await?;
        let used_a = before_a.saturating_sub(after_a);
        let used_b = before_b.saturating_sub(after_b);

        let position_pubkey = get_position_address(&position_mint)?.0;
        let position_data = fetch_position(&ctx.rpc, position_pubkey).await?;
        let pool_info = ctx.rpc.get_account(&position_data.whirlpool).await?;
        let pool = Whirlpool::from_bytes(&pool_info.data)?;

        let slippage_tolerance_bps = 100;

        let quote = get_constraining_quote(
            &param,
            slippage_tolerance_bps,
            pool.sqrt_price,
            position_data.tick_lower_index,
            position_data.tick_upper_index,
            None,
            None,
        )?;

        let is_te_fee = pool_name.contains("TEFee");
        let token_tolerance = if is_te_fee { 200u64 } else { 2u64 };
        let liquidity_tolerance_bps = if is_te_fee {
            200u128
        } else {
            RELATIVE_TOLERANCE_BPS
        };
        let liquidity_min_bps = if is_te_fee { 200u128 } else { MIN_ABSOLUTE_BPS };

        assert!(
            used_a <= quote.token_max_a + token_tolerance
                && (used_a + token_tolerance >= quote.token_est_a || quote.token_est_a == 0),
            "Token A usage out of range: used={}, est={}..{}",
            used_a,
            quote.token_est_a,
            quote.token_max_a
        );
        assert!(
            used_b <= quote.token_max_b + token_tolerance
                && (used_b + token_tolerance >= quote.token_est_b || quote.token_est_b == 0),
            "Token B usage out of range: used={}, est={}..{}",
            used_b,
            quote.token_est_b,
            quote.token_max_b
        );

        assert_liquidity_close(
            quote.liquidity_delta,
            position_data.liquidity,
            liquidity_tolerance_bps,
            liquidity_min_bps,
        );

        Ok(())
    }

    async fn setup_all_mints(
        ctx: &RpcContext,
    ) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let mint_a = setup_mint_with_decimals(ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(ctx, 9).await?;
        let mint_te_a = setup_mint_te(ctx, &[]).await?;
        let mint_te_b = setup_mint_te(ctx, &[]).await?;
        let mint_te_fee = setup_mint_te_fee(ctx).await?;

        let mut out = HashMap::new();
        out.insert("A", mint_a);
        out.insert("B", mint_b);
        out.insert("TEA", mint_te_a);
        out.insert("TEB", mint_te_b);
        out.insert("TEFee", mint_te_fee);

        Ok(out)
    }

    async fn setup_all_atas(
        ctx: &RpcContext,
        minted: &HashMap<&str, Pubkey>,
    ) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let token_balance = 1_000_000_000;
        let user_ata_a =
            setup_ata_with_amount(ctx, *minted.get("A").unwrap(), token_balance).await?;
        let user_ata_b =
            setup_ata_with_amount(ctx, *minted.get("B").unwrap(), token_balance).await?;
        let user_ata_te_a = setup_ata_te(
            ctx,
            *minted.get("TEA").unwrap(),
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;
        let user_ata_te_b = setup_ata_te(
            ctx,
            *minted.get("TEB").unwrap(),
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;
        let user_ata_tefee = setup_ata_te(
            ctx,
            *minted.get("TEFee").unwrap(),
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;

        let mut out = HashMap::new();
        out.insert("A", user_ata_a);
        out.insert("B", user_ata_b);
        out.insert("TEA", user_ata_te_a);
        out.insert("TEB", user_ata_te_b);
        out.insert("TEFee", user_ata_tefee);

        Ok(out)
    }

    pub fn parse_pool_name(pool_name: &str) -> (&'static str, &'static str) {
        match pool_name {
            "A-B" => ("A", "B"),
            "A-TEA" => ("A", "TEA"),
            "TEA-TEB" => ("TEA", "TEB"),
            "A-TEFee" => ("A", "TEFee"),

            _ => panic!("Unknown pool name: {}", pool_name),
        }
    }

    #[rstest]
    #[case("A-B", "equally centered", -100, 100)]
    #[case("A-B", "one sided A", -100, -1)]
    #[case("A-B", "one sided B", 1, 100)]
    #[case("A-TEA", "equally centered", -100, 100)]
    #[case("A-TEA", "one sided A", -100, -1)]
    #[case("A-TEA", "one sided B", 1, 100)]
    #[case("TEA-TEB", "equally centered", -100, 100)]
    #[case("TEA-TEB", "one sided A", -100, -1)]
    #[case("TEA-TEB", "one sided B", 1, 100)]
    #[case("A-TEFee", "equally centered", -100, 100)]
    #[case("A-TEFee", "one sided A", -100, -1)]
    #[case("A-TEFee", "one sided B", 1, 100)]
    #[serial]
    fn test_increase_liquidity_cases(
        #[case] pool_name: &str,
        #[case] _position_name: &str,
        #[case] lower_tick: i32,
        #[case] upper_tick: i32,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let ctx = RpcContext::new();

            let minted = setup_all_mints(&ctx).await.unwrap();
            let user_atas = setup_all_atas(&ctx, &minted).await.unwrap();

            let (mint_a_key, mint_b_key) = parse_pool_name(pool_name);
            let _pubkey_a = minted.get(mint_a_key).unwrap();
            let _pubkey_b = minted.get(mint_b_key).unwrap();
            let (mint_a_key, mint_b_key) = parse_pool_name(pool_name);
            let pubkey_a = *minted.get(mint_a_key).unwrap();
            let pubkey_b = *minted.get(mint_b_key).unwrap();

            let (final_a, final_b) = if pubkey_a < pubkey_b {
                (pubkey_a, pubkey_b)
            } else {
                (pubkey_b, pubkey_a)
            };

            // prevent flaky test by ordering the tokens correctly by lexical order
            let tick_spacing = 64;
            let swapped = pubkey_a > pubkey_b;
            let pool_pubkey = setup_whirlpool(&ctx, final_a, final_b, tick_spacing)
                .await
                .unwrap();
            let user_ata_for_token_a = if swapped {
                user_atas.get(mint_b_key).unwrap()
            } else {
                user_atas.get(mint_a_key).unwrap()
            };
            let user_ata_for_token_b = if swapped {
                user_atas.get(mint_a_key).unwrap()
            } else {
                user_atas.get(mint_b_key).unwrap()
            };

            let position_mint =
                setup_position(&ctx, pool_pubkey, Some((lower_tick, upper_tick)), None)
                    .await
                    .unwrap();

            let base_token_amount = 10_000u64;
            let (token_max_a, token_max_b) = match (lower_tick, upper_tick) {
                (-100, -1) => (0, base_token_amount), // one sided A -> deposit only B
                (1, 100) => (base_token_amount, 0),   // one sided B -> deposit only A
                _ => (base_token_amount, base_token_amount), // equally centered
            };
            let param = IncreaseLiquidityParam {
                token_max_a,
                token_max_b,
            };

            let inc_ix = increase_liquidity_instructions(
                &ctx.rpc,
                position_mint,
                param.clone(),
                Some(100), // slippage
                Some(ctx.signer.pubkey()),
            )
            .await
            .unwrap();

            verify_increase_liquidity(
                &ctx,
                &inc_ix,
                *user_ata_for_token_a,
                *user_ata_for_token_b,
                position_mint,
                param,
                pool_name,
            )
            .await
            .unwrap();
        });
    }

    #[tokio::test]
    #[serial]
    async fn test_increase_liquidity_fails_if_authority_is_default() -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new();

        let minted = setup_all_mints(&ctx).await?;
        let _user_atas = setup_all_atas(&ctx, &minted).await?;

        let mint_a_key = minted.get("A").unwrap();
        let mint_b_key = minted.get("B").unwrap();
        let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

        let position_mint = setup_position(&ctx, pool_pubkey, Some((-100, 100)), None).await?;

        use solana_pubkey::Pubkey;
        let param = IncreaseLiquidityParam {
            token_max_a: 100_000,
            token_max_b: 100_000,
        };
        let res = increase_liquidity_instructions(
            &ctx.rpc,
            position_mint,
            param,
            Some(100), // slippage
            Some(Pubkey::default()),
        )
        .await;

        assert!(res.is_err(), "Should have failed with default authority");
        let err_str = format!("{:?}", res.err().unwrap());
        assert!(
            err_str.contains("Authority must be provided")
                || err_str.contains("Signer must be provided"),
            "Error string was: {}",
            err_str
        );

        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_increase_liquidity_succeeds_if_deposit_exceeds_user_balance_when_balance_check_not_enforced(
    ) -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new();

        let minted = setup_all_mints(&ctx).await?;
        let _user_atas = setup_all_atas(&ctx, &minted).await?;

        let mint_a_key = minted.get("A").unwrap();
        let mint_b_key = minted.get("B").unwrap();
        let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

        let position_mint = setup_position(&ctx, pool_pubkey, Some((-100, 100)), None).await?;

        // Attempt - use a large token_max_b so the quote is constrained by token A.
        let param = IncreaseLiquidityParam {
            token_max_a: 2_000_000_000,
            token_max_b: 1_000_000_000_000,
        };
        let res = increase_liquidity_instructions(
            &ctx.rpc,
            position_mint,
            param,
            Some(100),
            Some(ctx.signer.pubkey()),
        )
        .await;

        assert!(
            res.is_ok(),
            "Should succeed when balance checking is disabled even if deposit exceeds balance"
        );

        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_increase_liquidity_fails_if_deposit_exceeds_user_balance_when_balance_check_enforced(
    ) -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new();
        crate::set_enforce_token_balance_check(true)?;

        let minted = setup_all_mints(&ctx).await?;
        let _user_atas = setup_all_atas(&ctx, &minted).await?;

        let mint_a_key = minted.get("A").unwrap();
        let mint_b_key = minted.get("B").unwrap();
        let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

        let position_mint = setup_position(&ctx, pool_pubkey, Some((-100, 100)), None).await?;

        // Attempt - use a large token_max_b so the quote is constrained by token A.
        let param = IncreaseLiquidityParam {
            token_max_a: 2_000_000_000,
            token_max_b: 1_000_000_000_000,
        };
        let res = increase_liquidity_instructions(
            &ctx.rpc,
            position_mint,
            param,
            Some(100),
            Some(ctx.signer.pubkey()),
        )
        .await;

        assert!(
            res.is_err(),
            "Should fail if user tries depositing more than balance when balance checking is enforced"
        );
        let err_str = format!("{:?}", res.err().unwrap());
        assert!(
            err_str.contains("Insufficient balance")
                || err_str.contains("Error processing Instruction 0"),
            "Unexpected error message: {}",
            err_str
        );

        crate::reset_configuration()?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_open_position_fails_if_lower_price_is_zero() -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new();

        let minted = setup_all_mints(&ctx).await?;
        let _user_atas = setup_all_atas(&ctx, &minted).await?;

        let mint_a_key = minted.get("A").unwrap();
        let mint_b_key = minted.get("B").unwrap();
        let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

        let _position_mint = setup_position(&ctx, pool_pubkey, Some((-100, 100)), None).await?;

        // Attempt
        let lower_price = 0.0; // if price is 0.0, open_position_instructions will be failed
        let param = IncreaseLiquidityParam {
            token_max_a: 2_000_000_000,
            token_max_b: 1_000_000,
        };
        let res = open_position_instructions(
            &ctx.rpc,
            pool_pubkey,
            lower_price,
            100.0,
            param,
            Some(100),
            Some(ctx.signer.pubkey()),
        )
        .await;

        assert!(
            res.is_err(),
            "Should fail if user tries to open position with price is very small"
        );
        let err_str = format!("{:?}", res.err().unwrap());
        assert!(
            err_str.contains("Floating price must be greater than 0.0"),
            "Unexpected error message: {}",
            err_str
        );

        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_open_position_fails_if_upper_price_is_zero() -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new();

        let minted = setup_all_mints(&ctx).await?;
        let _user_atas = setup_all_atas(&ctx, &minted).await?;

        let mint_a_key = minted.get("A").unwrap();
        let mint_b_key = minted.get("B").unwrap();
        let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

        let _position_mint = setup_position(&ctx, pool_pubkey, Some((-100, 100)), None).await?;

        // Attempt
        let upper_price = 0.0; // if price is 0.0, open_position_instructions will be failed
        let param = IncreaseLiquidityParam {
            token_max_a: 2_000_000_000,
            token_max_b: 1_000_000,
        };
        let res = open_position_instructions(
            &ctx.rpc,
            pool_pubkey,
            0.1,
            upper_price,
            param,
            Some(100),
            Some(ctx.signer.pubkey()),
        )
        .await;

        assert!(
            res.is_err(),
            "Should fail if user tries to open position with price is very small"
        );
        let err_str = format!("{:?}", res.err().unwrap());
        assert!(
            err_str.contains("Floating price must be greater than 0.0"),
            "Unexpected error message: {}",
            err_str
        );

        Ok(())
    }

    mod open_position_with_tick_bounds {
        use super::*;
        use crate::open_position_instructions_with_tick_bounds;

        #[tokio::test]
        #[serial]
        async fn fails_if_lower_tick_out_of_bounds() -> Result<(), Box<dyn Error>> {
            let ctx = RpcContext::new();

            let minted = setup_all_mints(&ctx).await?;
            setup_all_atas(&ctx, &minted).await?;

            let mint_a_key = minted.get("A").unwrap();
            let mint_b_key = minted.get("B").unwrap();
            let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

            let param = IncreaseLiquidityParam {
                token_max_a: 2_000_000_000,
                token_max_b: 1_000_000,
            };
            let res = open_position_instructions_with_tick_bounds(
                &ctx.rpc,
                pool_pubkey,
                i32::MAX,
                64,
                param,
                Some(100),
                Some(ctx.signer.pubkey()),
            )
            .await;

            assert!(
                res.is_err(),
                "Should fail if user tries to open position with lower tick out of bounds"
            );
            let err_str = format!("{:?}", res.err().unwrap());
            assert!(
                err_str.contains("Lower tick index is out of bounds"),
                "Unexpected error message: {}",
                err_str
            );

            Ok(())
        }

        #[tokio::test]
        #[serial]
        async fn fails_if_upper_tick_out_of_bounds() -> Result<(), Box<dyn Error>> {
            let ctx = RpcContext::new();

            let minted = setup_all_mints(&ctx).await?;
            setup_all_atas(&ctx, &minted).await?;

            let mint_a_key = minted.get("A").unwrap();
            let mint_b_key = minted.get("B").unwrap();
            let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

            let param = IncreaseLiquidityParam {
                token_max_a: 2_000_000_000,
                token_max_b: 1_000_000,
            };
            let res = open_position_instructions_with_tick_bounds(
                &ctx.rpc,
                pool_pubkey,
                0,
                i32::MAX,
                param,
                Some(100),
                Some(ctx.signer.pubkey()),
            )
            .await;

            assert!(
                res.is_err(),
                "Should fail if user tries to open position with upper tick out of bounds"
            );
            let err_str = format!("{:?}", res.err().unwrap());
            assert!(
                err_str.contains("Upper tick index is out of bounds"),
                "Unexpected error message: {}",
                err_str
            );

            Ok(())
        }

        #[tokio::test]
        #[serial]
        async fn fails_if_tick_not_aligned_with_tick_spacing() -> Result<(), Box<dyn Error>> {
            let ctx = RpcContext::new();

            let minted = setup_all_mints(&ctx).await?;
            setup_all_atas(&ctx, &minted).await?;

            let mint_a_key = minted.get("A").unwrap();
            let mint_b_key = minted.get("B").unwrap();
            let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

            let param = IncreaseLiquidityParam {
                token_max_a: 2_000_000_000,
                token_max_b: 1_000_000,
            };
            let res = open_position_instructions_with_tick_bounds(
                &ctx.rpc,
                pool_pubkey,
                1,  // not aligned with tick spacing 64
                64, // aligned
                param,
                Some(100),
                Some(ctx.signer.pubkey()),
            )
            .await;

            assert!(
                res.is_err(),
                "Should fail if user tries to open position with tick not aligned with tick spacing"
            );
            let err_str = format!("{:?}", res.err().unwrap());
            assert!(
                err_str.contains("Lower tick index 1 is not aligned with tick spacing 64"),
                "Unexpected error message: {}",
                err_str
            );

            Ok(())
        }

        #[tokio::test]
        #[serial]
        async fn fails_if_lower_tick_gte_upper_tick() -> Result<(), Box<dyn Error>> {
            let ctx = RpcContext::new();

            let minted = setup_all_mints(&ctx).await?;
            setup_all_atas(&ctx, &minted).await?;

            let mint_a_key = minted.get("A").unwrap();
            let mint_b_key = minted.get("B").unwrap();
            let pool_pubkey = setup_whirlpool(&ctx, *mint_a_key, *mint_b_key, 64).await?;

            let param = IncreaseLiquidityParam {
                token_max_a: 2_000_000_000,
                token_max_b: 1_000_000,
            };
            let res = open_position_instructions_with_tick_bounds(
                &ctx.rpc,
                pool_pubkey,
                64,
                64,
                param,
                Some(100),
                Some(ctx.signer.pubkey()),
            )
            .await;

            assert!(
                res.is_err(),
                "Should fail if user tries to open position with lower tick >= upper tick"
            );
            let err_str = format!("{:?}", res.err().unwrap());
            assert!(
                err_str.contains("Lower tick index 64 must be less than upper tick index 64"),
                "Unexpected error message: {}",
                err_str
            );

            Ok(())
        }
    }
}
