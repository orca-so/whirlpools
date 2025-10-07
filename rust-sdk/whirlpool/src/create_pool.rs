use std::collections::HashSet;
use std::error::Error;

use orca_whirlpools_client::Whirlpool;
use orca_whirlpools_client::{
    get_fee_tier_address, get_tick_array_address, get_token_badge_address, get_whirlpool_address,
    DynamicTickArray,
};
use orca_whirlpools_client::{
    InitializeDynamicTickArray, InitializeDynamicTickArrayInstructionArgs, InitializePoolV2,
    InitializePoolV2InstructionArgs,
};
use orca_whirlpools_core::{
    get_full_range_tick_indexes, get_tick_array_start_tick_index, price_to_sqrt_price,
    sqrt_price_to_tick_index,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::rent::Rent;
use solana_program::system_program;
use solana_program::sysvar::SysvarId;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use spl_token_2022::extension::StateWithExtensions;
use spl_token_2022::state::Mint;

use crate::token::order_mints;
use crate::{
    get_account_data_size, get_rent, FUNDER, SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS,
};

/// Represents the instructions and metadata for creating a pool.
pub struct CreatePoolInstructions {
    /// The list of instructions needed to create the pool.
    pub instructions: Vec<Instruction>,

    /// The estimated rent exemption cost for initializing the pool, in lamports.
    pub initialization_cost: u64,

    /// The address of the newly created pool.
    pub pool_address: Pubkey,

    /// The list of signers for the instructions.
    pub additional_signers: Vec<Keypair>,
}

/// Creates the necessary instructions to initialize a Splash Pool.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for communicating with the blockchain.
/// * `token_a` - The public key of the first token mint address to include in the pool.
/// * `token_b` - The public key of the second token mint address to include in the pool.
/// * `initial_price` - An optional initial price of token A in terms of token B. Defaults to 1.0 if not provided.
/// * `funder` - An optional public key of the account funding the initialization process. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `CreatePoolInstructions` on success:
/// * `instructions` - A vector of Solana instructions needed to initialize the pool.
/// * `initialization_cost` - The estimated rent exemption cost for initializing the pool, in lamports.
/// * `pool_address` - The public key of the newly created pool.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The funder account is invalid.
/// - Token mints are not found or have invalid data.
/// - The token mint order does not match the canonical byte order.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use orca_whirlpools::{
///     create_splash_pool_instructions, set_whirlpools_config_address, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::{pubkey::Pubkey, signature::Signer, signer::keypair::Keypair};
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let token_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
///     let token_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // devUSDC
///     let initial_price = Some(0.01);
///     let wallet = Keypair::new(); // CAUTION: This wallet is not persistent.
///     let funder = Some(wallet.pubkey());
///
///     let create_pool_instructions =
///         create_splash_pool_instructions(&rpc, token_a, token_b, initial_price, funder)
///             .await
///             .unwrap();
///
///     println!("Pool Address: {:?}", create_pool_instructions.pool_address);
///     println!(
///         "Initialization Cost: {} lamports",
///         create_pool_instructions.initialization_cost
///     );
/// }
/// ```
pub async fn create_splash_pool_instructions(
    rpc: &RpcClient,
    token_a: Pubkey,
    token_b: Pubkey,
    initial_price: Option<f64>,
    funder: Option<Pubkey>,
) -> Result<CreatePoolInstructions, Box<dyn Error>> {
    create_concentrated_liquidity_pool_instructions(
        rpc,
        token_a,
        token_b,
        SPLASH_POOL_TICK_SPACING,
        initial_price,
        funder,
    )
    .await
}

/// Creates the necessary instructions to initialize a Concentrated Liquidity Pool (CLMM).
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for communicating with the blockchain.
/// * `token_a` - The public key of the first token mint address to include in the pool.
/// * `token_b` - The public key of the second token mint address to include in the pool.
/// * `tick_spacing` - The spacing between price ticks for the pool.
/// * `initial_price` - An optional initial price of token A in terms of token B. Defaults to 1.0 if not provided.
/// * `funder` - An optional public key of the account funding the initialization process. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `CreatePoolInstructions` on success:
/// * `instructions` - A vector of Solana instructions needed to initialize the pool.
/// * `initialization_cost` - The estimated rent exemption cost for initializing the pool, in lamports.
/// * `pool_address` - The public key of the newly created pool.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The funder account is invalid.
/// - Token mints are not found or have invalid data.
/// - The token mint order does not match the canonical byte order.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```
/// use orca_whirlpools::{
///     create_concentrated_liquidity_pool_instructions, set_whirlpools_config_address,
///     WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::{pubkey::Pubkey, signature::Signer, signer::keypair::Keypair};
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let token_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
///     let token_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // devUSDC
///     let tick_spacing = 64;
///     let initial_price = Some(0.01);
///     let wallet = Keypair::new(); // CAUTION: This wallet is not persistent.
///     let funder = Some(wallet.pubkey());
///
///     let create_pool_instructions = create_concentrated_liquidity_pool_instructions(
///         &rpc,
///         token_a,
///         token_b,
///         tick_spacing,
///         initial_price,
///         funder,
///     )
///     .await
///     .unwrap();
///
///     println!("Pool Address: {:?}", create_pool_instructions.pool_address);
///     println!(
///         "Initialization Cost: {} lamports",
///         create_pool_instructions.initialization_cost
///     );
/// }
/// ```
pub async fn create_concentrated_liquidity_pool_instructions(
    rpc: &RpcClient,
    token_a: Pubkey,
    token_b: Pubkey,
    tick_spacing: u16,
    initial_price: Option<f64>,
    funder: Option<Pubkey>,
) -> Result<CreatePoolInstructions, Box<dyn Error>> {
    let initial_price = initial_price.unwrap_or(1.0);
    let funder = funder.unwrap_or(*FUNDER.try_lock()?);
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }
    if order_mints(token_a, token_b)[0] != token_a {
        return Err("Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)".into());
    }

    let rent = get_rent(rpc).await?;

    let account_infos = rpc.get_multiple_accounts(&[token_a, token_b]).await?;
    let mint_a_info = account_infos[0]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_a))?;
    let mint_a = StateWithExtensions::<Mint>::unpack(&mint_a_info.data)?;
    let decimals_a = mint_a.base.decimals;
    let token_program_a = mint_a_info.owner;
    let mint_b_info = account_infos[1]
        .as_ref()
        .ok_or(format!("Mint {} not found", token_b))?;
    let mint_b = StateWithExtensions::<Mint>::unpack(&mint_b_info.data)?;
    let decimals_b = mint_b.base.decimals;
    let token_program_b = mint_b_info.owner;

    let initial_sqrt_price: u128 = price_to_sqrt_price(initial_price, decimals_a, decimals_b);

    let whirlpools_config_address = *WHIRLPOOLS_CONFIG_ADDRESS.try_lock()?;
    let pool_address =
        get_whirlpool_address(&whirlpools_config_address, &token_a, &token_b, tick_spacing)?.0;

    let fee_tier = get_fee_tier_address(&whirlpools_config_address, tick_spacing)?.0;

    let token_badge_a = get_token_badge_address(&whirlpools_config_address, &token_a)?.0;

    let token_badge_b = get_token_badge_address(&whirlpools_config_address, &token_b)?.0;

    let token_vault_a = Keypair::new();
    let token_vault_b = Keypair::new();

    let mut initialization_cost: u64 = 0;
    let mut instructions = vec![];

    instructions.push(
        InitializePoolV2 {
            whirlpools_config: whirlpools_config_address,
            token_mint_a: token_a,
            token_mint_b: token_b,
            token_badge_a,
            token_badge_b,
            funder,
            whirlpool: pool_address,
            token_vault_a: token_vault_a.pubkey(),
            token_vault_b: token_vault_b.pubkey(),
            fee_tier,
            token_program_a,
            token_program_b,
            system_program: system_program::id(),
            rent: Rent::id(),
        }
        .instruction(InitializePoolV2InstructionArgs {
            initial_sqrt_price,
            tick_spacing,
        }),
    );

    initialization_cost += rent.minimum_balance(Whirlpool::LEN);
    let token_a_space = get_account_data_size(token_program_a, mint_a_info)?;
    initialization_cost += rent.minimum_balance(token_a_space);
    let token_b_space = get_account_data_size(token_program_b, mint_b_info)?;
    initialization_cost += rent.minimum_balance(token_b_space);

    let full_range = get_full_range_tick_indexes(tick_spacing);
    let lower_tick_index =
        get_tick_array_start_tick_index(full_range.tick_lower_index, tick_spacing);
    let upper_tick_index =
        get_tick_array_start_tick_index(full_range.tick_upper_index, tick_spacing);
    let initial_tick_index = sqrt_price_to_tick_index(initial_sqrt_price);
    let current_tick_index = get_tick_array_start_tick_index(initial_tick_index, tick_spacing);

    let tick_array_indexes =
        HashSet::from([lower_tick_index, upper_tick_index, current_tick_index]);
    for start_tick_index in tick_array_indexes {
        let tick_array_address = get_tick_array_address(&pool_address, start_tick_index)?;
        instructions.push(
            InitializeDynamicTickArray {
                whirlpool: pool_address,
                tick_array: tick_array_address.0,
                funder,
                system_program: system_program::id(),
            }
            .instruction(InitializeDynamicTickArrayInstructionArgs {
                start_tick_index,
                idempotent: false,
            }),
        );
        initialization_cost += rent.minimum_balance(DynamicTickArray::MIN_LEN);
    }

    Ok(CreatePoolInstructions {
        instructions,
        initialization_cost,
        pool_address,
        additional_signers: vec![token_vault_a, token_vault_b],
    })
}

#[cfg(test)]
mod tests {
    use crate::tests::{
        setup_mint, setup_mint_te, setup_mint_te_fee, setup_mint_te_sua, RpcContext,
    };

    use super::*;
    use serial_test::serial;

    async fn fetch_pool(
        rpc: &RpcClient,
        pool_address: Pubkey,
    ) -> Result<Whirlpool, Box<dyn Error>> {
        let account = rpc.get_account(&pool_address).await?;
        Whirlpool::from_bytes(&account.data).map_err(|e| e.into())
    }

    #[tokio::test]
    #[serial]
    async fn test_error_if_no_funder() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();

        let result =
            create_splash_pool_instructions(&ctx.rpc, mint_a, mint_b, Some(1.0), None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    #[serial]
    async fn test_error_if_tokens_not_ordered() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();

        let result = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint_b,
            mint_a,
            64,
            Some(1.0),
            Some(ctx.signer.pubkey()),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    #[serial]
    async fn test_create_splash_pool() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 9);

        let result = create_splash_pool_instructions(
            &ctx.rpc,
            mint_a,
            mint_b,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint_a, pool_after.token_mint_a);
        assert_eq!(mint_b, pool_after.token_mint_b);
        assert_eq!(SPLASH_POOL_TICK_SPACING, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_splash_pool_with_one_te_token() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te = setup_mint_te(&ctx, &[]).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_splash_pool_instructions(
            &ctx.rpc,
            mint,
            mint_te,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te, pool_after.token_mint_b);
        assert_eq!(SPLASH_POOL_TICK_SPACING, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_splash_pool_with_two_te_tokens() {
        let ctx = RpcContext::new().await;
        let mint_te_a = setup_mint_te(&ctx, &[]).await.unwrap();
        let mint_te_b = setup_mint_te(&ctx, &[]).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 6, 6);

        let result = create_splash_pool_instructions(
            &ctx.rpc,
            mint_te_a,
            mint_te_b,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint_te_a, pool_after.token_mint_a);
        assert_eq!(mint_te_b, pool_after.token_mint_b);
        assert_eq!(SPLASH_POOL_TICK_SPACING, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_splash_pool_with_transfer_fee() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te_fee = setup_mint_te_fee(&ctx).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_splash_pool_instructions(
            &ctx.rpc,
            mint,
            mint_te_fee,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te_fee, pool_after.token_mint_b);
        assert_eq!(SPLASH_POOL_TICK_SPACING, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 9);

        let result = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint_a,
            mint_b,
            64,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint_a, pool_after.token_mint_a);
        assert_eq!(mint_b, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_one_te_token() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te = setup_mint_te(&ctx, &[]).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint,
            mint_te,
            64,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_two_te_tokens() {
        let ctx = RpcContext::new().await;
        let mint_te_a = setup_mint_te(&ctx, &[]).await.unwrap();
        let mint_te_b = setup_mint_te(&ctx, &[]).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 6, 6);

        let result = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint_te_a,
            mint_te_b,
            64,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint_te_a, pool_after.token_mint_a);
        assert_eq!(mint_te_b, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_transfer_fee() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te_fee = setup_mint_te_fee(&ctx).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint,
            mint_te_fee,
            64,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te_fee, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_scaled_ui_amount() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te_sua = setup_mint_te_sua(&ctx).await.unwrap();
        let price = 10.0;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint,
            mint_te_sua,
            64,
            Some(price),
            Some(ctx.signer.pubkey()),
        )
        .await
        .unwrap();

        let balance_before = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx
            .rpc
            .get_account(&ctx.signer.pubkey())
            .await
            .unwrap()
            .lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te_sua, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
    }
}
