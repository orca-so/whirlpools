use orca_tx_sender::{
    FeeConfig, JitoFeeStrategy, Percentile, PriorityFeeStrategy, RpcConfig, TransactionSender,
};
use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{read_keypair_file, Keypair, Signer};
use std::error::Error;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::str::FromStr;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting Solana Transaction Sender Devnet Test");

    // Try to load keypair from file or create a new one
    let keypair_path = "devnet-test-keypair.json";
    let payer = if Path::new(keypair_path).exists() {
        println!("Loading existing keypair from {}", keypair_path);
        read_keypair_file(keypair_path).expect("Failed to read keypair file")
    } else {
        return Err("Keypair file does not exist".into());
    };

    // Use a fixed recipient account
    let recipient = Pubkey::from_str("5DX5Hwnw2xwSTg93TWgUmxcZVkBMxv25URizo83taNGd")?;

    println!("Test keypair:");
    println!("  Payer: {}", payer.pubkey());
    println!("  Recipient: {}", recipient);

    // Initialize configurations with devnet
    let start = Instant::now();
    println!("Connecting to Solana devnet...");
    let rpc_config = RpcConfig::with_chain_detection("https://api.devnet.solana.com")
        .await
        .expect("Failed to detect chain ID");

    println!(
        "Connected to chain: {} in {:?}",
        rpc_config.chain_name(),
        start.elapsed()
    );

    if !rpc_config.chain_name().contains("devnet") {
        println!(
            "Warning: Not connected to devnet! Connected to: {}",
            rpc_config.chain_name()
        );
    }

    // Configure fee settings
    let fee_config = FeeConfig {
        priority_fee: PriorityFeeStrategy::Dynamic {
            percentile: Percentile::P95,
            max_lamports: 10_000,
        },
        jito: JitoFeeStrategy::Disabled,
        compute_unit_margin_multiplier: 1.1,
        jito_block_engine_url: "https://jito-block-engine.com".to_string(),
    };

    // Create sender instance
    let sender = TransactionSender::new(rpc_config, fee_config);
    let client = sender.rpc_client();

    // Check balance
    let balance = client.get_balance(&payer.pubkey()).await?;
    println!("Account balance: {} lamports", balance);

    // If balance is still zero, we can't proceed
    let balance = client.get_balance(&payer.pubkey()).await?;
    if balance == 0 {
        println!("Error: Account has zero balance. Cannot proceed with test.");
        return Ok(());
    }

    // Create transfer instruction (send a very small amount)
    let transfer_amount = 1_000_000; // 0.001 SOL, enough to cover rent exemption
    println!(
        "Using transfer amount of {} lamports (0.001 SOL)",
        transfer_amount
    );
    let transfer_ix = system_instruction::transfer(&payer.pubkey(), &recipient, transfer_amount);

    println!("Sending {} lamports to {}", transfer_amount, recipient);

    // Build and send transaction
    let start = Instant::now();
    println!("Building and sending transaction...");
    let signature = sender
        .build_and_send_transaction(vec![transfer_ix], &[&payer])
        .await?;

    println!("Transaction sent: {}", signature);
    println!("Transaction sent in {:?}", start.elapsed());

    // Wait for confirmation
    let start = Instant::now();
    println!("Waiting for transaction confirmation...");
    let mut confirmed = false;
    while start.elapsed().as_secs() < 30 && !confirmed {
        if let Ok(status) = client.get_signature_status(&signature).await {
            if status.is_some() {
                confirmed = true;
                println!("Transaction confirmed in {:?}", start.elapsed());
                break;
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    Ok(())
}
