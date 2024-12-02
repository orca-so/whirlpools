use super::utils::{
    rpc::RpcContext,
    token::{setup_ata_with_amount, setup_mint_with_decimals},
    program::setup_whirlpool,
};
use crate::{
    fetch_concentrated_liquidity_pool, fetch_splash_pool, fetch_whirlpools_by_token_pair,
    SPLASH_POOL_TICK_SPACING, PoolInfo,
};
use serial_test::serial;

#[tokio::test]
#[serial]
async fn test_fetch_splash_pool() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    
    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await.unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await.unwrap();

    let splash_pool = setup_whirlpool(&ctx, mint_a, mint_b, SPLASH_POOL_TICK_SPACING).await.unwrap();

    if let PoolInfo::Initialized(pool) = fetch_splash_pool(&ctx.rpc, mint_a, mint_b).await.unwrap() {
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
    
    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await.unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await.unwrap();

    let concentrated_pool = setup_whirlpool(&ctx, mint_a, mint_b, 64).await.unwrap();

    if let PoolInfo::Initialized(pool) = fetch_concentrated_liquidity_pool(&ctx.rpc, mint_a, mint_b, 64)
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
    
    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await.unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await.unwrap();

    if let PoolInfo::Uninitialized(pool) = fetch_concentrated_liquidity_pool(&ctx.rpc, mint_a, mint_b, 128)
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
