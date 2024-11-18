use std::error::Error;

use orca_whirlpools_client::{
    fetch_all_fee_tier_with_filter, get_fee_tier_address, get_whirlpool_address, FeeTier,
    FeeTierFilter, Whirlpool, WhirlpoolsConfig,
};

use orca_whirlpools_core::sqrt_price_to_price;
use solana_client::rpc_client::RpcClient;
use solana_program::pubkey::Pubkey;
use solana_sdk::{program_error::ProgramError, program_pack::Pack};
use spl_token::state::Mint;

use crate::{token::order_mints, SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS};

/// Represents an uninitialized pool.
///
/// This struct contains the configuration and token details necessary to initialize a pool.
#[derive(Debug, Clone)]
pub struct UninitializedPool {
    /// The address of the pool.
    pub address: Pubkey,
    
    /// The whirlpools_config address for the pool.
    pub whirlpools_config: Pubkey,
    
    /// The spacing between ticks in the pool.
    pub tick_spacing: u16,
    
    /// The fee rate applied to swaps in the pool.
    pub fee_rate: u16,
    
    /// The protocol's share of fees.
    pub protocol_fee_rate: u16,
    
    /// The mint address for token A in the pool.
    pub token_mint_a: Pubkey,
    
    /// The mint address for token B in the pool.
    pub token_mint_b: Pubkey,
}


/// Represents an initialized pool.
///
/// This struct contains the pool's address, data, and current price.
#[derive(Debug, Clone)]
pub struct InitializedPool {
    /// The address of the pool.
    pub address: Pubkey,
    
    /// The `Whirlpool` struct containing the pool's state and configuration.
    pub data: Whirlpool,
    
    /// The current price in the pool.
    pub price: f64,
}


impl InitializedPool {
    fn from_bytes(
        bytes: &[u8],
        whirlpool_address: Pubkey,
        mint_a: Mint,
        mint_b: Mint,
    ) -> Result<Self, Box<dyn Error>> {
        let whirlpool = Whirlpool::from_bytes(bytes)?;
        let price = sqrt_price_to_price(whirlpool.sqrt_price, mint_a.decimals, mint_b.decimals);
        Ok(InitializedPool {
            address: whirlpool_address,
            data: whirlpool,
            price,
        })
    }
}

/// Represents information about a pool, either initialized or uninitialized.
///
/// This enum provides a unified way to describe both initialized and uninitialized pools,
/// encapsulating their specific data structures.
#[derive(Debug, Clone)]
pub enum PoolInfo {
    /// Represents a pool that has been initialized and contains its current state and price.
    /// - `InitializedPool` - The struct holding the initialized pool's data and price.
    Initialized(InitializedPool),
    
    /// Represents a pool that has not been initialized yet but contains its configuration and token details.
    /// - `UninitializedPool` - The struct holding the uninitialized pool's configuration details.
    Uninitialized(UninitializedPool),
}

/// Fetches the details of a specific Splash Pool.
///
/// This function retrieves information about a pool with the predefined tick spacing for Splash Pools.
/// It determines whether the pool is initialized or not and returns the corresponding details.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `token_1` - The public key of the first token mint in the pool.
/// * `token_2` - The public key of the second token mint in the pool.
///
/// # Returns
///
/// A `Result` containing `PoolInfo`:
/// * `PoolInfo::Initialized` if the pool is initialized, including the pool's state and price.
/// * `PoolInfo::Uninitialized` if the pool is not yet initialized, including configuration details.
///
/// # Errors
///
/// This function will return an error if:
/// - Any required account or mint information cannot be fetched.
/// - The pool or its configuration details are invalid.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::{fetch_splash_pool, PoolInfo, set_whirlpools_config_address, WhirlpoolsConfigInput};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
/// let token_1 = Pubkey::from_str("TOKEN_MINT_ONE").unwrap();
/// let token_2 = Pubkey::from_str("TOKEN_MINT_TWO").unwrap();
///
/// let pool_info = fetch_splash_pool(&rpc, token_1, token_2).unwrap();
/// match pool_info {
///     PoolInfo::Initialized(pool) => println!("Pool is initialized: {:?}", pool),
///     PoolInfo::Uninitialized(pool) => println!("Pool is not initialized: {:?}", pool),
/// }
/// ```
pub fn fetch_splash_pool(
    rpc: &RpcClient,
    token_1: Pubkey,
    token_2: Pubkey,
) -> Result<PoolInfo, Box<dyn Error>> {
    fetch_concentrated_liquidity_pool(rpc, token_1, token_2, SPLASH_POOL_TICK_SPACING)
}

/// Fetches the details of a specific Concentrated Liquidity Pool.
///
/// This function retrieves information about a pool for the specified tick spacing.
/// It determines whether the pool is initialized or not and returns the corresponding details.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `token_1` - The public key of the first token mint in the pool.
/// * `token_2` - The public key of the second token mint in the pool.
/// * `tick_spacing` - The tick spacing of the pool.
///
/// # Returns
///
/// A `Result` containing `PoolInfo`:
/// * `PoolInfo::Initialized` if the pool is initialized, including the pool's state and price.
/// * `PoolInfo::Uninitialized` if the pool is not yet initialized, including configuration details.
///
/// # Errors
///
/// This function will return an error if:
/// - Any required account or mint information cannot be fetched.
/// - The pool or its configuration details are invalid.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::{fetch_concentrated_liquidity_pool, PoolInfo, set_whirlpools_config_address, WhirlpoolsConfigInput};
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
/// let token_1 = Pubkey::from_str("TOKEN_MINT_ONE").unwrap();
/// let token_2 = Pubkey::from_str("TOKEN_MINT_TWO").unwrap();
/// let tick_spacing = 64;
///
/// let pool_info = fetch_concentrated_liquidity_pool(&rpc, token_1, token_2, tick_spacing).unwrap();
/// match pool_info {
///     PoolInfo::Initialized(pool) => println!("Pool is initialized: {:?}", pool),
///     PoolInfo::Uninitialized(pool) => println!("Pool is not initialized: {:?}", pool),
/// }
/// ```
pub fn fetch_concentrated_liquidity_pool(
    rpc: &RpcClient,
    token_1: Pubkey,
    token_2: Pubkey,
    tick_spacing: u16,
) -> Result<PoolInfo, Box<dyn Error>> {
    let whirlpools_config_address = &*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?;
    let [token_a, token_b] = order_mints(token_1, token_2);
    let whirlpool_address =
        get_whirlpool_address(whirlpools_config_address, &token_a, &token_b, tick_spacing)?.0;

    let fee_tier_address = get_fee_tier_address(whirlpools_config_address, tick_spacing)?;

    let account_infos = rpc.get_multiple_accounts(&[
        whirlpool_address,
        *whirlpools_config_address,
        fee_tier_address.0,
        token_a,
        token_b,
    ])?;

    let whirlpools_config_info = account_infos[1].as_ref().ok_or(format!(
        "Whirlpools config {} not found",
        whirlpools_config_address
    ))?;
    let whirlpools_config = WhirlpoolsConfig::from_bytes(&whirlpools_config_info.data)?;

    let fee_tier_info = account_infos[2]
        .as_ref()
        .ok_or(format!("Fee tier {} not found", fee_tier_address.0))?;
    let fee_tier = FeeTier::from_bytes(&fee_tier_info.data)?;

    let mint_a_info = account_infos[3]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_a))?;
    let mint_a = Mint::unpack(&mint_a_info.data)?;

    let mint_b_info = account_infos[4]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_b))?;
    let mint_b = Mint::unpack(&mint_b_info.data)?;

    if let Some(whirlpool_info) = &account_infos[0] {
        let initialized_pool =
            InitializedPool::from_bytes(&whirlpool_info.data, whirlpool_address, mint_a, mint_b)?;
        Ok(PoolInfo::Initialized(initialized_pool))
    } else {
        Ok(PoolInfo::Uninitialized(UninitializedPool {
            address: whirlpool_address,
            whirlpools_config: *whirlpools_config_address,
            tick_spacing,
            fee_rate: fee_tier.default_fee_rate,
            protocol_fee_rate: whirlpools_config.default_protocol_fee_rate,
            token_mint_a: token_a,
            token_mint_b: token_b,
        }))
    }
}

/// Fetches all possible liquidity pools between two token mints in Orca Whirlpools.
///
/// This function retrieves information about all pools between the specified token mints,
/// including both initialized and uninitialized pools. If a pool does not exist, it creates
/// a placeholder account for the uninitialized pool with default configuration details.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `token_1` - The public key of the first token mint in the pool.
/// * `token_2` - The public key of the second token mint in the pool.
///
/// # Returns
///
/// A `Result` containing a `Vec<PoolInfo>`:
/// * `PoolInfo::Initialized` for initialized pools, including pool state and price.
/// * `PoolInfo::Uninitialized` for uninitialized pools, including configuration details.
///
/// # Errors
///
/// This function will return an error if:
/// - Any required account or mint information cannot be fetched.
/// - The pool or its configuration details are invalid.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools:{
///     fetch_whirlpools_by_token_pair, PoolInfo, set_whirlpools_config_address, WhirlpoolsConfigInput,
/// };
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
/// let token_1 = Pubkey::from_str("TOKEN_MINT_ONE").unwrap();
/// let token_2 = Pubkey::from_str("TOKEN_MINT_TWO").unwrap();
///
/// let pools = fetch_whirlpools_by_token_pair(&rpc, token_1, token_2).unwrap();
/// for pool in pools {
///     match pool {
///         PoolInfo::Initialized(pool) => println!("Initialized Pool: {:?}", pool),
///         PoolInfo::Uninitialized(pool) => println!("Uninitialized Pool: {:?}", pool),
///     }
/// }
/// ```
pub fn fetch_whirlpools_by_token_pair(
    rpc: &RpcClient,
    token_1: Pubkey,
    token_2: Pubkey,
) -> Result<Vec<PoolInfo>, Box<dyn Error>> {
    let whirlpools_config_address = &*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?;
    let [token_a, token_b] = order_mints(token_1, token_2);

    let fee_tiers = fetch_all_fee_tier_with_filter(
        rpc,
        vec![FeeTierFilter::WhirlpoolsConfig(*whirlpools_config_address)],
    )?;

    let account_infos =
        rpc.get_multiple_accounts(&[*whirlpools_config_address, token_a, token_b])?;

    let whirlpools_config_info = account_infos[0].as_ref().ok_or(format!(
        "Whirlpools config {} not found",
        whirlpools_config_address
    ))?;
    let whirlpools_config = WhirlpoolsConfig::from_bytes(&whirlpools_config_info.data)?;

    let mint_a_info = account_infos[1]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_a))?;
    let mint_a = Mint::unpack(&mint_a_info.data)?;

    let mint_b_info = account_infos[2]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_b))?;
    let mint_b = Mint::unpack(&mint_b_info.data)?;

    let whirlpool_addresses: Vec<Pubkey> = fee_tiers
        .iter()
        .map(|fee_tier| fee_tier.data.tick_spacing)
        .map(|tick_spacing| {
            get_whirlpool_address(whirlpools_config_address, &token_a, &token_b, tick_spacing)
        })
        .map(|x| x.map(|y| y.0))
        .collect::<Result<Vec<Pubkey>, ProgramError>>()?;

    let whirlpool_infos = rpc.get_multiple_accounts(&whirlpool_addresses)?;

    let mut whirlpools: Vec<PoolInfo> = Vec::new();
    for i in 0..whirlpool_infos.len() {
        let pool_address = whirlpool_addresses[i];
        let pool_info = whirlpool_infos[i].as_ref();
        let fee_tier = &fee_tiers[i];

        if let Some(pool_info) = pool_info {
            let initialized_pool =
                InitializedPool::from_bytes(&pool_info.data, pool_address, mint_a, mint_b)?;
            whirlpools.push(PoolInfo::Initialized(initialized_pool));
        } else {
            whirlpools.push(PoolInfo::Uninitialized(UninitializedPool {
                address: pool_address,
                whirlpools_config: *whirlpools_config_address,
                tick_spacing: fee_tier.data.tick_spacing,
                fee_rate: fee_tier.data.default_fee_rate,
                protocol_fee_rate: whirlpools_config.default_protocol_fee_rate,
                token_mint_a: token_a,
                token_mint_b: token_b,
            }));
        }
    }

    Ok(whirlpools)
}
