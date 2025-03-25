use orca_tx_sender::{
    build_and_send_transaction,
    JitoFeeStrategy, Percentile, JitoPercentile, PriorityFeeStrategy, SendOptions,
    set_priority_fee_strategy, set_jito_fee_strategy, set_compute_unit_margin_multiplier, 
    set_jito_block_engine_url, set_rpc, get_rpc_client
};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signer;
use std::error::Error;
use std::str::FromStr;
use std::time::Instant;
use solana_sdk::commitment_config::CommitmentLevel;
use std::env;

// Import our utility module
mod util;


// Can be used with any RPC URL
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting Solana Transaction Sender Test with Jito");

    // Load keypair from Solana CLI config using the util function
    let payer = util::load_keypair_from_config()?;
    println!("Test keypair:");
    println!("  Payer: {}", payer.pubkey());

    // Get RPC URL from command line args or use devnet as default
    let rpc_url = env::args().nth(1).unwrap_or_else(|| "https://api.devnet.solana.com".to_string());
   

    // Initialize RPC configuration
    println!("Connecting to Solana at {}...", rpc_url);
    
    // Set the RPC configuration globally
    set_rpc(&rpc_url).await?;

    println!("Connected to chain");

    // Check balance
    let client = get_rpc_client()?;
    let balance = client.get_balance(&payer.pubkey()).await?;
    println!("Account balance: {} lamports", balance);

    // If balance is still zero, we can't proceed
    if balance == 0 {
        println!("Error: Account has zero balance. Cannot proceed with test.");
        return Ok(());
    }

    // 1. Configure fee settings with dynamic priority fees and Jito fees
    let compute_multiplier = 1.1;
    let jito_url = "https://bundles.jito.wtf".to_string();
    
    // Set individual configuration options
    set_priority_fee_strategy(PriorityFeeStrategy::Dynamic {
        percentile: Percentile::P95,
        max_lamports: 10_000,
    })?;
    
    set_jito_fee_strategy(JitoFeeStrategy::Dynamic {
        percentile: JitoPercentile::P95,
        max_lamports: 10_000,
    })?;
    set_compute_unit_margin_multiplier(compute_multiplier)?;
    set_jito_block_engine_url(jito_url.clone())?;

    // Create a memo instruction
    let memo_data = format!("Hello from the Orca transaction sender!");
    let memo_program_id = Pubkey::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap();
    let memo_instruction = util::create_memo_instruction(memo_program_id, &payer.pubkey(), &memo_data);

    // Create SendOptions with more retries
    let options = SendOptions {
        commitment: CommitmentLevel::Confirmed,                  
        timeout_ms: 60_000,
    };

    // Build and send transaction with dynamic priority fees and Jito fees
    let start = Instant::now();
    println!("Building and sending transaction with dynamic priority fees and Jito fees...");
    
    let signature = build_and_send_transaction(
        vec![memo_instruction.clone()],
        &[&payer],
        Some(options.clone()),
        None,
    ).await?;

    println!("Transaction sent: {}", signature);
    println!("Transaction with dynamic fees sent in {:?}", start.elapsed());

    // 2. Now update fee config to disable priority fees but keep Jito fees
    println!("Changing priority fee strategy to Disabled...");
    set_priority_fee_strategy(PriorityFeeStrategy::Disabled)?;

    // Build and send transaction with no priority fees but with Jito fees
    let start = Instant::now();
    println!("Building and sending transaction with no priority fees but with Jito fees...");
    
    let signature = build_and_send_transaction(
        vec![memo_instruction],
        &[&payer],
        Some(options),
        None,
    ).await?;

    println!("Transaction sent: {}", signature);
    println!("Transaction with Jito fees only sent in {:?}", start.elapsed());

    Ok(())
}
