# orca_tx_sender

A Rust crate for building and sending Solana transactions with priority fees and Jito tips.

## Features

- Dynamic priority fee calculation based on recent network fees
- Jito tip support for MEV extraction
- Automatic compute unit budget estimation
- Retry logic with exponential backoff
- Configurable transaction parameters
- Async/await support with Tokio

## Version Compatibility

- Solana CLI: 1.17.22
- Solana SDK: 1.17.22

## Installation

Add the following to your `Cargo.toml`:

```toml
[dependencies]
orca_tx_sender = { version = "0.1.0" }
```

## Usage Example

```rust
use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_tx_sender::{
    FeeConfig, PriorityFeeStrategy, Percentile, RpcConfig, TransactionSender,
};
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize configurations
    let rpc_config = RpcConfig::with_chain_detection("https://api.mainnet-beta.solana.com")
        .await?;

    println!("Connected to chain: {}", rpc_config.chain_name());

    let fee_config = FeeConfig {
        priority_fee: PriorityFeeStrategy::Dynamic {
            percentile: Percentile::P95,
            max_lamports: 1_000_000, // 1 SOL
        },
        ..Default::default()
    };

    // Create sender instance
    let sender = TransactionSender::new(rpc_config, fee_config);

    // Create a keypair for signing
    let keypair = Keypair::new();

    // Jupiter Program address as an example recipient
    let recipient = Pubkey::from_str("JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo").unwrap();

    // Create transfer instruction
    let transfer_ix = system_instruction::transfer(
        &keypair.pubkey(),
        &recipient,
        1_000_000, // 0.001 SOL
    );

    // Build and send transaction
    let signature = sender
        .build_and_send_transaction(vec![transfer_ix], &[&keypair])
        .await?;

    println!("Transaction confirmed: {}", signature);
    Ok(())
}
```

## Configuration Options

### RPC Configuration

```rust
let rpc_config = RpcConfig {
    url: "https://api.mainnet-beta.solana.com".to_string(),
    supports_priority_fee_percentile: true,
    timeout: Duration::from_secs(30),
    ..Default::default()
};
```

### Fee Configuration

```rust
let fee_config = FeeConfig {
    // Dynamic priority fees based on network conditions
    priority_fee: PriorityFeeStrategy::Dynamic {
        percentile: Percentile::P95,
        max_lamports: 1_000_000, // 1 SOL
    },

    // Fixed priority fee
    // priority_fee: PriorityFeeStrategy::Exact(10_000),

    // No priority fee
    // priority_fee: PriorityFeeStrategy::Disabled,

    // Compute unit margin multiplier (default: 1.1)
    compute_unit_margin_multiplier: 1.2,

    ..Default::default()
};
```

### Transaction Configuration

```rust
let tx_config = TransactionConfig {
    skip_preflight: false,
    preflight_commitment: Some(CommitmentLevel::Confirmed),
    max_retries: 5,
    timeout: Duration::from_secs(60),
};

let sender = TransactionSender::new(rpc_config, fee_config)
    .with_tx_config(tx_config);

sender.build_and_send_transaction(instructions, signers).await?;
```

## License

Orca License

See [LICENSE](../../LICENSE) for details.
