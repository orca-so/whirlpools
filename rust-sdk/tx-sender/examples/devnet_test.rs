use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_tx_sender::{
    FeeConfig, PriorityFeeStrategy, Percentile, RpcConfig, TransactionSender,
};
use std::error::Error;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting Solana Transaction Sender Devnet Test");
    
    // Create a new keypair for testing
    let payer = Keypair::new();
    let recipient = Keypair::new().pubkey();
    
    println!("Test keypair generated:");
    println!("  Payer: {}", payer.pubkey());
    println!("  Recipient: {}", recipient);
    
    // Initialize configurations with devnet
    let start = Instant::now();
    println!("Connecting to Solana devnet...");
    let rpc_config = RpcConfig::with_chain_detection("https://api.devnet.solana.com")
        .await
        .expect("Failed to detect chain ID");
    
    println!("Connected to chain: {} in {:?}", rpc_config.chain_name(), start.elapsed());
    
    if !rpc_config.chain_name().contains("devnet") {
        println!("Warning: Not connected to devnet! Connected to: {}", rpc_config.chain_name());
    }
    
    // Configure fees for devnet (lower than mainnet)
    let fee_config = FeeConfig {
        priority_fee: PriorityFeeStrategy::Dynamic {
            percentile: Percentile::P75,
            max_lamports: 100_000, // 0.0001 SOL max for devnet
        },
        ..Default::default()
    };

    // Create sender instance
    let sender = TransactionSender::new(rpc_config, fee_config);
    
    // Request airdrop for the test keypair
    println!("Requesting airdrop of 1 SOL for test account...");
    let client = sender.rpc_client();
    let airdrop_signature = client
        .request_airdrop(&payer.pubkey(), 1_000_000_000) // 1 SOL
        .await?;
    
    println!("Airdrop requested: {}", airdrop_signature);
    println!("Waiting for airdrop confirmation...");
    
    // Wait for confirmation
    let start = Instant::now();
    let mut confirmed = false;
    while start.elapsed().as_secs() < 30 && !confirmed {
        if let Ok(status) = client.get_signature_status(&airdrop_signature).await {
            if status.is_some() {
                confirmed = true;
                println!("Airdrop confirmed in {:?}", start.elapsed());
                break;
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }
    
    if !confirmed {
        println!("Airdrop not confirmed after 30 seconds, but continuing anyway");
    }
    
    // Check balance
    let balance = client.get_balance(&payer.pubkey()).await?;
    println!("Account balance: {} lamports", balance);
    
    if balance == 0 {
        println!("Error: Account has zero balance. Airdrop may have failed.");
        return Ok(());
    }
    
    // Create transfer instruction (send a small amount)
    let transfer_amount = 100_000; // 0.0001 SOL
    let transfer_ix = system_instruction::transfer(
        &payer.pubkey(),
        &recipient,
        transfer_amount,
    );
    
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
    confirmed = false;
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
    
    if !confirmed {
        println!("Transaction not confirmed after 30 seconds");
        return Ok(());
    }
    
    // Verify recipient balance
    let recipient_balance = client.get_balance(&recipient).await?;
    println!("Recipient balance: {} lamports", recipient_balance);
    
    if recipient_balance == transfer_amount {
        println!("✅ Test successful! Transfer verified.");
    } else {
        println!("❌ Test failed! Recipient balance doesn't match transfer amount.");
    }
    
    Ok(())
} 