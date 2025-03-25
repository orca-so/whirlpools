use orca_tx_sender::{
    build_and_send_transaction,
    JitoFeeStrategy, PriorityFeeStrategy, SendOptions,
    set_priority_fee_strategy, set_jito_fee_strategy, set_rpc, get_rpc_client
};
use solana_sdk::{
    address_lookup_table::{
        state::AddressLookupTable,
        AddressLookupTableAccount,
    },
    pubkey::Pubkey,
    signature::Signer,
    commitment_config::CommitmentLevel,
};
use std::error::Error;
use std::str::FromStr;
use std::time::Instant;
use std::env;

mod util;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting Solana Transaction Sender Test with Address Lookup Tables");

    // Load keypair from Solana CLI config using the util function
    let payer = util::load_keypair_from_config()?;
    println!("Test keypair:");
    println!("  Payer: {}", payer.pubkey());

    // Get RPC URL from command line args or use mainnet as default (ALTs typically used on mainnet)
    let rpc_url = env::args().nth(1).unwrap_or_else(|| "https://api.mainnet-beta.solana.com".to_string());

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

    // Set fee strategies
    set_priority_fee_strategy(PriorityFeeStrategy::Disabled)?;
    set_jito_fee_strategy(JitoFeeStrategy::Disabled)?;

    // Create a memo instruction
    let memo_data = format!("Hello from versioned transactions with address lookup tables!");
    let memo_program_id = Pubkey::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap();
    let memo_instruction = util::create_memo_instruction(memo_program_id, &payer.pubkey(), &memo_data);

    // Example address lookup table account
    // NOTE: In a real application, you would fetch an actual ALT from the chain
    // For demonstration purposes, we'll create a mock ALT
    let lookup_table_address = Pubkey::from_str("HUCQnXBV24s6KpQULXJPQS2iiVPTZw53yCEjPcCzQ3vJ").unwrap();
    
    // Try to fetch a real ALT or create a mock one
    println!("Attempting to fetch address lookup table...");
    
    let alt_option = match client.get_account(&lookup_table_address).await {
        Ok(account) => {
            println!("Found ALT account on-chain! Attempting to parse...");
            match AddressLookupTable::deserialize(&account.data) {
                Ok(alt) => {
                    println!("Successfully parsed ALT with {} addresses", alt.addresses.len());
                    Some(AddressLookupTableAccount {
                        key: lookup_table_address,
                        addresses: alt.addresses.to_vec(),
                    })
                },
                Err(e) => {
                    println!("Failed to parse ALT: {}", e);
                    None
                }
            }
        },
        Err(_) => {
            println!("ALT not found. Creating a mock ALT for demonstration.");
            // Create a mock ALT with some arbitrary addresses for demonstration
            let addresses = vec![
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                Pubkey::new_unique(),
            ];
            
            println!("Mock ALT contains {} addresses", addresses.len());
            Some(AddressLookupTableAccount {
                key: lookup_table_address,
                addresses,
            })
        }
    };
    
    // Create SendOptions with more retries
    let options = SendOptions {
        commitment: CommitmentLevel::Confirmed,                  
        timeout_ms: 60_000,
    };

    // Build and send transaction with address lookup tables
    let start = Instant::now();
    println!("Building and sending transaction with address lookup tables...");
    
    // Get the vector of ALTs from the option
    let alts = alt_option.map(|alt| vec![alt]);
    
    let signature = build_and_send_transaction(
        vec![memo_instruction],
        &[&payer],
        Some(options),
        alts,
    ).await?;

    println!("Transaction sent: {}", signature);
    println!("Versioned transaction with ALTs sent in {:?}", start.elapsed());

    Ok(())
} 