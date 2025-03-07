use orca_tx_sender::{
    FeeConfig, JitoFeeStrategy, JitoPercentile, Percentile, PriorityFeeStrategy, RpcConfig,
    TransactionConfig, TransactionSender,
};
use solana_program::system_instruction;
use solana_sdk::commitment_config::CommitmentLevel;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signer;
use solana_sdk::signer::keypair::read_keypair_file;
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

    // Configure RPC and fee settings with Jito tip
    let fee_config = FeeConfig {
        priority_fee: PriorityFeeStrategy::Dynamic {
            percentile: Percentile::P95,
            max_lamports: 1_000_000,
        },
        jito: JitoFeeStrategy::Dynamic {
            percentile: JitoPercentile::P50Ema,
            max_lamports: 1_000_000,
        },
        compute_unit_margin_multiplier: 1.1,
        jito_block_engine_url: "https://jito-block-engine.com".to_string(),
    };

    // Configure transaction parameters
    let tx_config = TransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(CommitmentLevel::Confirmed),
        max_retries: 5,
        timeout: Duration::from_secs(60),
    };

    // Create sender instance with custom transaction config
    let sender = TransactionSender::new(rpc_config, fee_config).with_tx_config(tx_config);

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
