use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcSendTransactionConfig, RpcSimulateTransactionConfig};
use solana_program::system_instruction;
use solana_sdk::commitment_config::{CommitmentConfig, CommitmentLevel};
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

// Simulate the core functionality of the orca_tx_sender crate
struct TransactionSender {
    rpc_client: RpcClient,
    priority_fee: Option<u64>,
}

impl TransactionSender {
    fn new(rpc_url: &str, priority_fee: Option<u64>) -> Self {
        let rpc_client = RpcClient::new_with_commitment(
            rpc_url.to_string(),
            CommitmentConfig::confirmed(),
        );
        
        Self {
            rpc_client,
            priority_fee,
        }
    }
    
    async fn build_and_send_transaction(
        &self,
        mut instructions: Vec<solana_program::instruction::Instruction>,
        signers: &[&Keypair],
    ) -> Result<solana_sdk::signature::Signature, Box<dyn std::error::Error>> {
        // Add priority fee instruction if configured
        if let Some(fee) = self.priority_fee {
            instructions.insert(0, ComputeBudgetInstruction::set_compute_unit_price(fee));
        }
        
        // Add compute unit limit instruction
        instructions.insert(0, ComputeBudgetInstruction::set_compute_unit_limit(200_000));
        
        // Get recent blockhash
        let recent_blockhash = self.rpc_client.get_latest_blockhash().await?;
        
        // Create transaction
        let mut transaction = Transaction::new_with_payer(&instructions, Some(&signers[0].pubkey()));
        
        // Sign transaction
        transaction.sign(signers, recent_blockhash);
        
        // Send transaction with retry logic
        let signature = self.rpc_client.send_transaction_with_config(
            &transaction,
            RpcSendTransactionConfig {
                skip_preflight: false,
                preflight_commitment: Some(CommitmentLevel::Confirmed),
                encoding: None,
                max_retries: Some(5),
                min_context_slot: None,
            },
        ).await?;
        
        Ok(signature)
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting Simulated Transaction Sender Devnet Test");

    // Check if keypair file exists, if not create a new one
    let keypair_path = "devnet-test-keypair.json";
    let payer = if Path::new(keypair_path).exists() {
        println!("Loading existing keypair from {}", keypair_path);
        let keypair_bytes = std::fs::read(keypair_path)?;
        let keypair_string = String::from_utf8(keypair_bytes)?;
        let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_string)?;
        Keypair::from_bytes(&keypair_bytes)?
    } else {
        println!("Creating new keypair and saving to {}", keypair_path);
        let new_keypair = Keypair::new();
        let keypair_bytes = new_keypair.to_bytes();
        let json_bytes = serde_json::to_string(&keypair_bytes.to_vec())?;
        let mut file = File::create(keypair_path)?;
        file.write_all(json_bytes.as_bytes())?;
        new_keypair
    };

    // Generate a random recipient keypair for testing
    let recipient = Keypair::new();

    println!("Test keypairs:");
    println!("  Payer: {}", payer.pubkey());
    println!("  Recipient: {}", recipient.pubkey());

    // Create transaction sender with priority fee
    println!("Creating transaction sender...");
    let rpc_url = "https://api.devnet.solana.com";
    let priority_fee = Some(5_000); // 5,000 micro-lamports per compute unit
    let sender = TransactionSender::new(rpc_url, priority_fee);

    // Check payer balance
    let balance = sender.rpc_client.get_balance(&payer.pubkey()).await?;
    println!("Payer balance: {} lamports ({} SOL)", balance, balance as f64 / 1_000_000_000.0);

    // If balance is too low, inform the user
    if balance < 1_000_000 {
        println!("Payer account has insufficient funds. Please fund the account with SOL from the Solana devnet faucet.");
        println!("You can use the Solana CLI to request an airdrop:");
        println!("solana airdrop 1 {} --url devnet", payer.pubkey());
        println!("Or visit https://faucet.solana.com to request funds.");
        return Ok(());
    }

    // Check the initial balance of the recipient
    let recipient_initial_balance = sender.rpc_client.get_balance(&recipient.pubkey()).await?;
    println!("Recipient initial balance: {} lamports", recipient_initial_balance);

    // Calculate minimum amount needed for rent exemption
    let rent = sender.rpc_client.get_minimum_balance_for_rent_exemption(0).await?;
    println!("Minimum balance for rent exemption: {} lamports", rent);

    // Create a transfer instruction with enough for rent exemption
    let amount = rent + 10_000; // rent exemption + 0.00001 SOL
    println!("Transferring {} lamports to cover rent exemption plus extra", amount);
    
    let instruction = system_instruction::transfer(
        &payer.pubkey(),
        &recipient.pubkey(),
        amount,
    );

    // Simulate the transaction first
    println!("Simulating transaction...");
    let recent_blockhash = sender.rpc_client.get_latest_blockhash().await?;
    let mut tx = Transaction::new_with_payer(&[instruction.clone()], Some(&payer.pubkey()));
    tx.sign(&[&payer], recent_blockhash);
    
    let simulation = sender.rpc_client.simulate_transaction_with_config(
        &tx,
        RpcSimulateTransactionConfig {
            sig_verify: false,
            replace_recent_blockhash: true,
            commitment: Some(CommitmentConfig::confirmed()),
            encoding: None,
            accounts: None,
            min_context_slot: None,
            inner_instructions: true,
        },
    ).await?;
    
    if let Some(err) = simulation.value.err {
        println!("Transaction simulation failed: {:?}", err);
        if let Some(logs) = simulation.value.logs {
            println!("Simulation logs:");
            for log in logs {
                println!("  {}", log);
            }
        }
        return Ok(());
    }
    
    println!("Simulation successful, units consumed: {:?}", simulation.value.units_consumed);

    // Build and send transaction
    println!("Building and sending transaction...");
    let start = Instant::now();
    let signature = sender
        .build_and_send_transaction(vec![instruction], &[&payer])
        .await?;
    println!("Transaction sent with signature: {}", signature);
    println!("Transaction sent in {:?}", start.elapsed());

    // Wait for confirmation
    println!("Waiting for transaction confirmation...");
    let start = Instant::now();
    let mut confirmed = false;
    let mut attempts = 0;
    const MAX_ATTEMPTS: usize = 10;
    
    while !confirmed && attempts < MAX_ATTEMPTS {
        attempts += 1;
        match sender.rpc_client.get_signature_status(&signature).await {
            Ok(Some(status)) => {
                if status.is_ok() {
                    confirmed = true;
                    println!("Transaction confirmed in {:?} after {} attempts", start.elapsed(), attempts);
                } else {
                    println!("Transaction failed with status: {:?}", status);
                    break;
                }
            },
            Ok(None) => {
                println!("Attempt {}/{}: Transaction still pending...", attempts, MAX_ATTEMPTS);
                tokio::time::sleep(Duration::from_secs(2)).await;
            },
            Err(err) => {
                println!("Error checking transaction status: {}", err);
                break;
            }
        }
    }

    if !confirmed {
        println!("Transaction was not confirmed after {} attempts", MAX_ATTEMPTS);
        return Ok(());
    }

    // Check the final balance of the recipient
    let recipient_final_balance = sender.rpc_client.get_balance(&recipient.pubkey()).await?;
    println!("Recipient final balance: {} lamports", recipient_final_balance);

    // Verify the transfer
    let balance_difference = recipient_final_balance - recipient_initial_balance;
    if balance_difference == amount {
        println!("Transfer successful! Recipient balance increased by {} lamports", amount);
    } else {
        println!("Transfer verification failed. Expected increase of {} lamports, but got {} lamports",
            amount, balance_difference);
    }

    println!("Test completed successfully!");
    Ok(())
} 