use super::utils::{
    rpc::RpcContext,
    token::{setup_ata_with_amount, setup_mint_with_decimals},
    program::{setup_whirlpool, setup_position, setup_te_position, setup_position_bundle},
};
use crate::{
    get_positions_for_owner, fetch_positions_in_whirlpool, SPLASH_POOL_TICK_SPACING,
};
use serial_test::serial;
use solana_sdk::{signer::Signer, signature::Keypair};

#[tokio::test]
#[serial]
async fn test_fetch_positions_for_owner() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    
    // Setup ATAs with initial amounts
    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await.unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await.unwrap();

    // Create pools
    let pool = setup_whirlpool(&ctx, mint_a, mint_b, 128).await.unwrap();
    let splash_pool = setup_whirlpool(&ctx, mint_a, mint_b, SPLASH_POOL_TICK_SPACING).await.unwrap();

    // Create positions
    setup_position(&ctx, pool).await.unwrap();
    setup_position(&ctx, splash_pool).await.unwrap();
    setup_te_position(&ctx, pool).await.unwrap();
    setup_position_bundle(&ctx, pool, vec![()]).await.unwrap();
    setup_position_bundle(&ctx, splash_pool, vec![(), ()]).await.unwrap();

    // Test fetching positions for owner
    let positions = get_positions_for_owner(&ctx.rpc, ctx.signer.pubkey())
        .await
        .unwrap();
    assert_eq!(positions.len(), 5);

    // Test fetching positions for different address
    let other = Keypair::new();
    let positions = get_positions_for_owner(&ctx.rpc, other.pubkey())
        .await
        .unwrap();
    assert_eq!(positions.len(), 0);
}

#[tokio::test]
#[serial]
async fn test_fetch_positions_in_whirlpool() {
    let ctx = RpcContext::new().await;
    let mint_a = setup_mint_with_decimals(&ctx, 9).await.unwrap();
    let mint_b = setup_mint_with_decimals(&ctx, 9).await.unwrap();

    // Setup ATAs with initial amounts
    setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await.unwrap();
    setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await.unwrap();

    // Create pool and positions
    let pool = setup_whirlpool(&ctx, mint_a, mint_b, 128).await.unwrap();
    setup_position(&ctx, pool).await.unwrap();
    setup_te_position(&ctx, pool).await.unwrap();
    setup_position_bundle(&ctx, pool, vec![()]).await.unwrap();

    // Test fetching positions in whirlpool
    let positions = fetch_positions_in_whirlpool(&ctx.rpc, pool)
        .await
        .unwrap();
    assert_eq!(positions.len(), 3);
}
