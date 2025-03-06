use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::signer::keypair::read_keypair_file;
use solana_tx_sender::{
    FeeConfig, PriorityFeeStrategy, Percentile, JitoFeeStrategy, RpcConfig, TransactionSender,
};
use std::error::Error;
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Load keypair from file
    let keypair = read_keypair_file("~/.config/solana/id.json")?;
    
    // Initialize configurations
    let rpc_config = RpcConfig::with_chain_detection("https://api.mainnet-beta.solana.com")
        .await
        .expect("Failed to detect chain ID");
    
    println!("Connected to chain: {}", rpc_config.chain_name());
    
    let fee_config = FeeConfig {
        priority_fee: PriorityFeeStrategy::Dynamic {
            percentile: Percentile::P95,
            max_lamports: 1_000_000,
        },
        jito: JitoFeeStrategy::Disabled,
        ..Default::default()
    };

    // Create sender instance
    let sender = TransactionSender::new(rpc_config, fee_config);
    
    // Recipient address - Solana Foundation address
    let recipient = Pubkey::from_str("JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo").unwrap();
    
    // Create transfer instruction
    let transfer_ix = system_instruction::transfer(
        &keypair.pubkey(),
        &recipient,
        1_000_000, // 0.001 SOL
    );

    println!("Sending 0.001 SOL to {}", recipient);
    
    // Build and send transaction
    let signature = sender
        .build_and_send_transaction(vec![transfer_ix], &[&keypair])
        .await?;

    println!("Transaction confirmed: {}", signature);
    Ok(())
} 