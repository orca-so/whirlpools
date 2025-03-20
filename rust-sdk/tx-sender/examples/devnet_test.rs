use orca_tx_sender::{
    build_and_send_transaction,
    JitoFeeStrategy, Percentile, PriorityFeeStrategy, SendOptions,
    set_priority_fee_strategy, set_jito_fee_strategy, set_compute_unit_margin_multiplier, 
    set_jito_block_engine_url, set_rpc, get_rpc_client
};
use solana_program::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{read_keypair_file, Signer};
use std::error::Error;
use std::path::Path;
use std::str::FromStr;
use std::time::Instant;
use solana_sdk::instruction::AccountMeta;
use solana_sdk::commitment_config::CommitmentLevel;

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

    println!("Test keypair:");
    println!("  Payer: {}", payer.pubkey());

    // Initialize RPC configuration with devnet
    let start = Instant::now();
    println!("Connecting to Solana devnet...");
    
    // Set the RPC configuration globally
    set_rpc("https://api.devnet.solana.com").await?;

    println!(
        "Connected to chain: {} in {:?}",
        "devnet",
        start.elapsed()
    );

    // Check balance
    let client = get_rpc_client()?;
    let balance = client.get_balance(&payer.pubkey()).await?;
    println!("Account balance: {} lamports", balance);

    // If balance is still zero, we can't proceed
    if balance == 0 {
        println!("Error: Account has zero balance. Cannot proceed with test.");
        return Ok(());
    }

    // 1. Configure fee settings with dynamic priority fees and no Jito fees
    let compute_multiplier = 1.1;
    let jito_url = "https://bundles.jito.wtf".to_string();
    
    // Set individual configuration options
    set_priority_fee_strategy(PriorityFeeStrategy::Dynamic {
        percentile: Percentile::P95,
        max_lamports: 10_000,
    })?;
    
    set_jito_fee_strategy(JitoFeeStrategy::Disabled)?;
    set_compute_unit_margin_multiplier(compute_multiplier)?;
    set_jito_block_engine_url(jito_url.clone())?;

    // Create a memo instruction
    let memo_data = "Hello from the new transaction sender!";
    let memo_program_id = Pubkey::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap();
    let memo_instruction = create_memo_instruction(memo_program_id, &payer.pubkey(), memo_data);

    // Create SendOptions with more retries
    let options = SendOptions {
        skip_preflight: true,            // Skip preflight checks
        commitment: CommitmentLevel::Confirmed,
        max_retries: 5,                  
        timeout_ms: 60_000,
    };

    // Build and send transaction with dynamic priority fees
    let start = Instant::now();
    println!("Building and sending transaction with dynamic priority fees...");
    
    let signature = build_and_send_transaction(
        vec![memo_instruction.clone()],
        &[&payer],
        Some(options.clone()),
    ).await?;

    println!("Transaction sent: {}", signature);
    println!("Transaction with dynamic fees sent in {:?}", start.elapsed());

    // 2. Now update fee config to disable priority fees
    println!("Changing priority fee strategy to Disabled...");
    set_priority_fee_strategy(PriorityFeeStrategy::Disabled)?;

    // Build and send transaction with no priority fees
    let start = Instant::now();
    println!("Building and sending transaction with no priority fees...");
    
    let signature = build_and_send_transaction(
        vec![memo_instruction],
        &[&payer],
        Some(options),
    ).await?;

    println!("Transaction sent: {}", signature);
    println!("Transaction with no fees sent in {:?}", start.elapsed());

    Ok(())
}

// Helper function to create a memo instruction
fn create_memo_instruction(program_id: Pubkey, signer: &Pubkey, memo: &str) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![AccountMeta::new_readonly(*signer, true)],
        data: memo.as_bytes().to_vec(),
    }
}
