use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::system_instruction;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;
use std::error::Error;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting Minimal Solana Devnet Test");
    
    // Create a new keypair for testing
    let payer = Keypair::new();
    let recipient = Keypair::new().pubkey();
    
    println!("Test keypair generated:");
    println!("  Payer: {}", payer.pubkey());
    println!("  Recipient: {}", recipient);
    
    // Connect to devnet
    let start = Instant::now();
    println!("Connecting to Solana devnet...");
    let client = RpcClient::new("https://api.devnet.solana.com".to_string());
    
    // Get genesis hash to verify connection
    let genesis_hash = client.get_genesis_hash().await?;
    println!("Connected to devnet in {:?}", start.elapsed());
    println!("Genesis hash: {}", genesis_hash);
    
    // Request airdrop for the test keypair
    println!("Requesting airdrop of 1 SOL for test account...");
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
    
    // Get recent blockhash
    let recent_blockhash = client.get_latest_blockhash().await?;
    
    // Create and sign transaction
    let mut transaction = Transaction::new_with_payer(&[transfer_ix], Some(&payer.pubkey()));
    transaction.sign(&[&payer], recent_blockhash);
    
    // Send transaction
    let start = Instant::now();
    println!("Sending transaction...");
    let signature = client.send_transaction(&transaction).await?;
    
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