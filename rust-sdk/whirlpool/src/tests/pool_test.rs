use super::utils::{
    program::setup_whirlpool,
    rpc::RpcContext,
    token::{setup_ata_with_amount, setup_mint_with_decimals},
};
use crate::{
    fetch_concentrated_liquidity_pool, fetch_splash_pool, fetch_whirlpools_by_token_pair, PoolInfo,
    SPLASH_POOL_TICK_SPACING,
};
use serial_test::serial;

#[tokio::test]
#[serial]
async fn test_fetch_splash_pool() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();

    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000)
        .await
        .unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000)
        .await
        .unwrap();

    let splash_pool = setup_whirlpool(&ctx, mint_a, mint_b, SPLASH_POOL_TICK_SPACING)
        .await
        .unwrap();

    if let PoolInfo::Initialized(pool) = fetch_splash_pool(&ctx.rpc, mint_a, mint_b).await.unwrap()
    {
        assert_eq!(pool.data.liquidity, 0);
        assert_eq!(pool.data.tick_spacing, SPLASH_POOL_TICK_SPACING);
        assert_eq!(pool.address, splash_pool);
        assert_eq!(pool.data.token_mint_a, mint_a);
        assert_eq!(pool.data.token_mint_b, mint_b);
        assert_eq!(pool.data.fee_rate, 1000);
        assert_eq!(pool.data.protocol_fee_rate, 0);
    } else {
        panic!("Expected initialized pool");
    }
}

#[tokio::test]
#[serial]
async fn test_fetch_concentrated_liquidity_pool() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();

    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000)
        .await
        .unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000)
        .await
        .unwrap();

    let concentrated_pool = setup_whirlpool(&ctx, mint_a, mint_b, 64).await.unwrap();

    if let PoolInfo::Initialized(pool) =
        fetch_concentrated_liquidity_pool(&ctx.rpc, mint_a, mint_b, 64)
            .await
            .unwrap()
    {
        assert_eq!(pool.data.liquidity, 0);
        assert_eq!(pool.data.tick_spacing, 64);
        assert_eq!(pool.address, concentrated_pool);
        assert_eq!(pool.data.token_mint_a, mint_a);
        assert_eq!(pool.data.token_mint_b, mint_b);
        assert_eq!(pool.data.fee_rate, 300);
        assert_eq!(pool.data.protocol_fee_rate, 0);
    } else {
        panic!("Expected initialized pool");
    }
}

#[tokio::test]
#[serial]
async fn test_fetch_non_existent_pool() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();

    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000)
        .await
        .unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000)
        .await
        .unwrap();

    if let PoolInfo::Uninitialized(pool) =
        fetch_concentrated_liquidity_pool(&ctx.rpc, mint_a, mint_b, 128)
            .await
            .unwrap()
    {
        assert_eq!(pool.tick_spacing, 128);
        assert_eq!(pool.token_mint_a, mint_a);
        assert_eq!(pool.token_mint_b, mint_b);
        assert_eq!(pool.fee_rate, 1000);
        assert_eq!(pool.protocol_fee_rate, 0);
    } else {
        panic!("Expected uninitialized pool");
    }
}

#[tokio::test]
#[serial]
async fn test_fetch_all_pools_for_pair() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();

    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000)
        .await
        .unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000)
        .await
        .unwrap();

    // Create pools with different tick spacings
    let concentrated_pool = setup_whirlpool(&ctx, mint_a, mint_b, 64).await.unwrap();
    let splash_pool = setup_whirlpool(&ctx, mint_a, mint_b, SPLASH_POOL_TICK_SPACING)
        .await
        .unwrap();

    let pools = fetch_whirlpools_by_token_pair(&ctx.rpc, mint_a, mint_b)
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
        assert_eq!(pool.address, concentrated_pool);
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
        assert_eq!(pool.address, splash_pool);
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
