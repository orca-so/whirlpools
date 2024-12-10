use std::error::Error;

use orca_whirlpools_client::{
    fetch_all_fee_tier_with_filter, get_fee_tier_address, get_whirlpool_address, FeeTier,
    FeeTierFilter, Whirlpool, WhirlpoolsConfig,
};

use orca_whirlpools_core::sqrt_price_to_price;
use solana_client::nonblocking::rpc_client::RpcClient;
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
/// use orca_whirlpools::{
///     fetch_splash_pool, set_whirlpools_config_address, PoolInfo, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let token_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
///     let token_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // devUSDC
///
///     let pool_info = fetch_splash_pool(&rpc, token_a, token_b).await.unwrap();
///
///     match pool_info {
///         PoolInfo::Initialized(pool) => println!("Pool is initialized: {:?}", pool),
///         PoolInfo::Uninitialized(pool) => println!("Pool is not initialized: {:?}", pool),
///     }
/// }
/// ```
pub async fn fetch_splash_pool(
    rpc: &RpcClient,
    token_1: Pubkey,
    token_2: Pubkey,
) -> Result<PoolInfo, Box<dyn Error>> {
    fetch_concentrated_liquidity_pool(rpc, token_1, token_2, SPLASH_POOL_TICK_SPACING).await
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
/// use orca_whirlpools::{
///     fetch_concentrated_liquidity_pool, set_whirlpools_config_address, PoolInfo,
///     WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let token_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
///     let token_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // devUSDC
///     let tick_spacing = 64;
///
///     let pool_info = fetch_concentrated_liquidity_pool(&rpc, token_a, token_b, tick_spacing)
///         .await
///         .unwrap();
///
///     match pool_info {
///         PoolInfo::Initialized(pool) => println!("Pool is initialized: {:?}", pool),
///         PoolInfo::Uninitialized(pool) => println!("Pool is not initialized: {:?}", pool),
///     }
/// }
/// ```
pub async fn fetch_concentrated_liquidity_pool(
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

    let account_infos = rpc
        .get_multiple_accounts(&[
            whirlpool_address,
            *whirlpools_config_address,
            fee_tier_address.0,
            token_a,
            token_b,
        ])
        .await?;

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
/// use orca_whirlpools::{
///     fetch_whirlpools_by_token_pair, set_whirlpools_config_address, PoolInfo, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let token_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
///     let token_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // devUSDC
///
///     let pool_infos = fetch_whirlpools_by_token_pair(&rpc, token_a, token_b)
///         .await
///         .unwrap();
///
///     for pool_info in pool_infos {
///         match pool_info {
///             PoolInfo::Initialized(pool) => println!("Pool is initialized: {:?}", pool),
///             PoolInfo::Uninitialized(pool) => println!("Pool is not initialized: {:?}", pool),
///         }
///     }
/// }
/// ```
pub async fn fetch_whirlpools_by_token_pair(
    rpc: &RpcClient,
    token_1: Pubkey,
    token_2: Pubkey,
) -> Result<Vec<PoolInfo>, Box<dyn Error>> {
    let whirlpools_config_address = &*WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?;
    let [token_a, token_b] = order_mints(token_1, token_2);

    let fee_tiers = fetch_all_fee_tier_with_filter(
        rpc,
        vec![FeeTierFilter::WhirlpoolsConfig(*whirlpools_config_address)],
    )
    .await?;

    let account_infos = rpc
        .get_multiple_accounts(&[*whirlpools_config_address, token_a, token_b])
        .await?;

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

    let whirlpool_infos = rpc.get_multiple_accounts(&whirlpool_addresses).await?;

    let mut whirlpools: Vec<PoolInfo> = Vec::new();
    for i in 0..whirlpool_addresses.len() {
        let pool_address = whirlpool_addresses[i];
        let pool_info = whirlpool_infos.get(i).and_then(|x| x.as_ref());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{
        setup_ata_with_amount, setup_mint_with_decimals, setup_whirlpool, RpcContext,
    };
    use serial_test::serial;
    use solana_program_test::tokio;
    use solana_sdk::signer::Signer;

    struct TestContext {
        ctx: RpcContext,
        mint_a: Pubkey,
        mint_b: Pubkey,
        splash_pool: Pubkey,
        concentrated_pool: Pubkey,
    }

    impl TestContext {
        async fn new() -> Result<Self, Box<dyn Error>> {
            let ctx = RpcContext::new().await;
            let mint_a = setup_mint_with_decimals(&ctx, 9).await?;
            let mint_b = setup_mint_with_decimals(&ctx, 9).await?;

            setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await?;
            setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await?;

            // Setup all pools
            let concentrated_pool = setup_whirlpool(&ctx, mint_a, mint_b, 64).await?;
            let splash_pool =
                setup_whirlpool(&ctx, mint_a, mint_b, SPLASH_POOL_TICK_SPACING).await?;

            Ok(Self {
                ctx,
                mint_a,
                mint_b,
                splash_pool,
                concentrated_pool,
            })
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_fetch_splash_pool() {
        let test_ctx = TestContext::new().await.unwrap();

        if let PoolInfo::Initialized(pool) =
            fetch_splash_pool(&test_ctx.ctx.rpc, test_ctx.mint_a, test_ctx.mint_b)
                .await
                .unwrap()
        {
            assert_eq!(pool.data.liquidity, 0);
            assert_eq!(pool.data.tick_spacing, SPLASH_POOL_TICK_SPACING);
            assert_eq!(pool.address, test_ctx.splash_pool);
            assert_eq!(pool.data.token_mint_a, test_ctx.mint_a);
            assert_eq!(pool.data.token_mint_b, test_ctx.mint_b);
            assert_eq!(pool.data.fee_rate, 1000);
            assert_eq!(pool.data.protocol_fee_rate, 0);
        } else {
            panic!("Expected initialized pool");
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_fetch_concentrated_liquidity_pool() {
        let test_ctx = TestContext::new().await.unwrap();

        if let PoolInfo::Initialized(pool) = fetch_concentrated_liquidity_pool(
            &test_ctx.ctx.rpc,
            test_ctx.mint_a,
            test_ctx.mint_b,
            64,
        )
        .await
        .unwrap()
        {
            assert_eq!(pool.data.liquidity, 0);
            assert_eq!(pool.data.tick_spacing, 64);
            assert_eq!(pool.address, test_ctx.concentrated_pool);
            assert_eq!(pool.data.token_mint_a, test_ctx.mint_a);
            assert_eq!(pool.data.token_mint_b, test_ctx.mint_b);
            assert_eq!(pool.data.fee_rate, 300);
            assert_eq!(pool.data.protocol_fee_rate, 0);
        } else {
            panic!("Expected initialized pool");
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_fetch_non_existent_pool() {
        let test_ctx = TestContext::new().await.unwrap();

        if let PoolInfo::Uninitialized(pool) = fetch_concentrated_liquidity_pool(
            &test_ctx.ctx.rpc,
            test_ctx.mint_a,
            test_ctx.mint_b,
            128,
        )
        .await
        .unwrap()
        {
            assert_eq!(pool.tick_spacing, 128);
            assert_eq!(pool.token_mint_a, test_ctx.mint_a);
            assert_eq!(pool.token_mint_b, test_ctx.mint_b);
            assert_eq!(pool.fee_rate, 1000);
            assert_eq!(pool.protocol_fee_rate, 0);
        } else {
            panic!("Expected uninitialized pool");
        }
    }

    #[tokio::test]
    #[serial]
    #[ignore = "Skipped until solana-bankrun supports getProgramAccounts"]
    async fn test_fetch_all_pools_for_pair() {
        let test_ctx = TestContext::new().await.unwrap();

        let pools =
            fetch_whirlpools_by_token_pair(&test_ctx.ctx.rpc, test_ctx.mint_a, test_ctx.mint_b)
                .await
                .unwrap();

        assert_eq!(pools.len(), 3); // 2 initialized + 1 uninitialized (128 tick spacing)

        // Verify concentrated liquidity pool
        let concentrated = pools
            .iter()
            .find(|p| match p {
                PoolInfo::Initialized(p) => p.data.tick_spacing == 64,
                _ => false,
            })
            .unwrap();
        if let PoolInfo::Initialized(pool) = concentrated {
            assert_eq!(pool.address, test_ctx.concentrated_pool);
            assert_eq!(pool.data.fee_rate, 300);
        }

        // Verify splash pool
        let splash = pools
            .iter()
            .find(|p| match p {
                PoolInfo::Initialized(p) => p.data.tick_spacing == SPLASH_POOL_TICK_SPACING,
                _ => false,
            })
            .unwrap();
        if let PoolInfo::Initialized(pool) = splash {
            assert_eq!(pool.address, test_ctx.splash_pool);
            assert_eq!(pool.data.fee_rate, 1000);
        }

        // Verify uninitialized pool
        let uninitialized = pools
            .iter()
            .find(|p| match p {
                PoolInfo::Uninitialized(p) => p.tick_spacing == 128,
                _ => false,
            })
            .unwrap();
        if let PoolInfo::Uninitialized(pool) = uninitialized {
            assert_eq!(pool.fee_rate, 1000);
        }
    }
}
