use super::utils::{rpc::RpcContext, token::*, token_extensions::*};
use crate::NativeMintWrappingStrategy;
use serial_test::serial;
use solana_sdk::signer::Signer;
use spl_token::native_mint;
use spl_token_2022::{extension::ExtensionType, ID as TOKEN_2022_PROGRAM_ID};

#[tokio::test]
#[serial]
async fn test_no_tokens() {
    let ctx = RpcContext::new().await;
    let result = prepare_token_accounts_instructions(&ctx, ctx.signer.pubkey(), vec![])
        .await
        .unwrap();

    assert_eq!(result.create_instructions.len(), 0);
    assert_eq!(result.cleanup_instructions.len(), 0);
    assert_eq!(result.token_account_addresses.len(), 0);
}

#[tokio::test]
#[serial]
async fn test_native_mint_wrapping_none() {
    let ctx = RpcContext::new().await;
    crate::set_native_mint_wrapping_strategy(NativeMintWrappingStrategy::None).unwrap();

    let result = prepare_token_accounts_instructions(
        &ctx,
        ctx.signer.pubkey(),
        vec![TokenAccountStrategy::WithoutBalance(native_mint::ID)],
    )
    .await
    .unwrap();

    assert_eq!(result.create_instructions.len(), 1); // Create ATA
    assert_eq!(result.cleanup_instructions.len(), 0);
    assert_eq!(result.token_account_addresses.len(), 1);
}

#[tokio::test]
#[serial]
async fn test_native_mint_wrapping_ata() {
    let ctx = RpcContext::new().await;
    crate::set_native_mint_wrapping_strategy(NativeMintWrappingStrategy::Ata).unwrap();

    let result = prepare_token_accounts_instructions(
        &ctx,
        ctx.signer.pubkey(),
        vec![TokenAccountStrategy::WithBalance(
            native_mint::ID,
            1_000_000,
        )],
    )
    .await
    .unwrap();

    assert_eq!(result.create_instructions.len(), 3); // Create ATA + transfer + sync_native
    assert_eq!(result.cleanup_instructions.len(), 0);
    assert_eq!(result.token_account_addresses.len(), 1);
}

#[tokio::test]
#[serial]
async fn test_native_mint_wrapping_keypair() {
    let ctx = RpcContext::new().await;
    crate::set_native_mint_wrapping_strategy(NativeMintWrappingStrategy::Keypair).unwrap();

    let result = prepare_token_accounts_instructions(
        &ctx,
        ctx.signer.pubkey(),
        vec![TokenAccountStrategy::WithBalance(
            native_mint::ID,
            1_000_000,
        )],
    )
    .await
    .unwrap();

    assert_eq!(result.create_instructions.len(), 2); // create + initialize
    assert_eq!(result.cleanup_instructions.len(), 1); // close
    assert_eq!(result.token_account_addresses.len(), 1);
    assert_eq!(result.additional_signers.len(), 1);
}

#[tokio::test]
#[serial]
async fn test_token_2022_account() {
    let ctx = RpcContext::new().await;

    // Create basic Token-2022 mint
    let mint = setup_mint_te(&ctx, None).await.unwrap();

    // Test ATA creation
    let result = prepare_token_accounts_instructions(
        &ctx,
        ctx.signer.pubkey(),
        vec![TokenAccountStrategy::WithoutBalance(mint)],
    )
    .await
    .unwrap();

    // Validate account data
    let account = ctx.rpc.get_account(&mint).await.unwrap();
    assert_eq!(account.data.len(), 82); // Standard mint size
    assert_eq!(result.create_instructions.len(), 1);
    assert_eq!(result.cleanup_instructions.len(), 0);
    assert_eq!(result.token_account_addresses.len(), 1);
}

#[tokio::test]
#[serial]
async fn test_token_2022_with_transfer_fee() {
    let ctx = RpcContext::new().await;

    // Create Token-2022 mint with transfer fee config
    let mint = setup_mint_te_fee(&ctx, None).await.unwrap();

    // Verify extension creation
    let calls = ctx.token_calls.read().await;
    assert!(calls.contains(&"create_token_2022_mint".to_string()));

    // Verify account data
    let account = ctx.rpc.get_account(&mint).await.unwrap();
    assert!(account.data.len() > 82); // Size is larger due to extension
    assert_eq!(account.owner, TOKEN_2022_PROGRAM_ID);
}
