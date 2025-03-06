use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::signer::keypair::read_keypair_file;
use solana_tx_sender::{
    FeeConfig, PriorityFeeStrategy, JitoFeeStrategy, JitoPercentile, 
    Percentile, RpcConfig, TransactionSender, TransactionConfig,
};
use solana_sdk::commitment_config::CommitmentLevel;
use std::error::Error;
use std::str::FromStr;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Load keypair from file
    let keypair = read_keypair_file("~/.config/solana/id.json")?;
    
    // Initialize configurations
    let rpc_config = RpcConfig::with_chain_detection("https://api.mainnet-beta.solana.com")
        .await
        .expect("Failed to detect chain ID");
    
    println!("Connected to chain: {}", rpc_config.chain_name());
    
    // Configure both priority fees and Jito tips
    let fee_config = FeeConfig {
        // Dynamic priority fees based on network conditions
        priority_fee: PriorityFeeStrategy::Dynamic {
            percentile: Percentile::P95,
            max_lamports: 1_000_000, // 1 SOL max
        },
        
        // Dynamic Jito tips based on recent tips
        jito: JitoFeeStrategy::Dynamic {
            percentile: JitoPercentile::P50Ema,
            max_lamports: 500_000, // 0.5 SOL max
        },
        
        // Compute unit margin multiplier (default: 1.1)
        compute_unit_margin_multiplier: 1.2,
        
        // Jito block engine URL
        jito_block_engine_url: "https://bundles.jito.wtf".to_string(),
    };

    // Configure transaction parameters
    let tx_config = TransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(CommitmentLevel::Confirmed),
        max_retries: 5,
        timeout: Duration::from_secs(60),
    };

    // Create sender instance with custom transaction config
    let sender = TransactionSender::new(rpc_config, fee_config)
        .with_tx_config(tx_config);
    
    // Recipient address - Jupiter Program
    let recipient = Pubkey::from_str("JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo").unwrap();
    
    // Create transfer instruction
    let transfer_ix = system_instruction::transfer(
        &keypair.pubkey(),
        &recipient,
        1_000_000, // 0.001 SOL
    );
    
    println!("Sending 0.001 SOL to {} with Jito tip", recipient);
    
    // Build and send transaction
    let signature = sender
        .build_and_send_transaction(vec![transfer_ix], &[&keypair])
        .await?;

    println!("Transaction confirmed: {}", signature);
    Ok(())
} 