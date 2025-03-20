# orca_tx_sender

A Rust crate for building and sending Solana transactions with priority fees and Jito tips.

## Features

- Dynamic priority fee calculation based on recent network fees
- Jito tip support for MEV extraction
- Automatic compute unit budget estimation
- Retry logic with exponential backoff
- Configurable transaction parameters
- Async/await support with Tokio
- Global configuration with thread-safe access

## Version Compatibility

- Solana CLI: >=1.16, <3.0
- Solana SDK: >=1.16

## Installation

Add the following to your `Cargo.toml`:

```toml
[dependencies]
orca_tx_sender = { version = "0.1.0" }
```

## Usage Examples

### Global Configuration Approach

```rust
use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::commitment_config::CommitmentLevel;
use orca_tx_sender::{
    set_rpc, set_priority_fee_strategy,
    build_and_send_transaction, SendOptions,
    PriorityFeeStrategy, Percentile
};
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Set global RPC configuration (required!)
    set_rpc("https://api.mainnet-beta.solana.com").await?;

    // Configure priority fees globally
    set_priority_fee_strategy(PriorityFeeStrategy::Dynamic {
        percentile: Percentile::P95,
        max_lamports: 1_000_000, // 1 SOL
    })?;

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

    // Custom send options (optional)
    let options = SendOptions {
        skip_preflight: false,
        commitment: CommitmentLevel::Confirmed,
        max_retries: 5,
        timeout_ms: 60_000, // 60 seconds
    };

    // Build and send transaction using global configuration with custom options
    let signature = build_and_send_transaction(
        vec![transfer_ix],
        &[&keypair],
        Some(options)
    ).await?;

    // Or use default options
    // let signature = build_and_send_transaction(
    //     vec![transfer_ix],
    //     &[&keypair],
    //     None
    // ).await?;

    println!("Transaction confirmed: {}", signature);
    Ok(())
}
```

### Direct Instance Approach

```rust
use solana_program::system_instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::commitment_config::CommitmentLevel;
use orca_tx_sender::{
    FeeConfig, PriorityFeeStrategy, Percentile, RpcConfig,
    TransactionSender, SendOptions,
};
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize configurations
    let rpc_config = RpcConfig::new("https://api.mainnet-beta.solana.com")
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

    // Custom send options (optional)
    let options = SendOptions {
        skip_preflight: false,
        commitment: CommitmentLevel::Confirmed,
        max_retries: 5,
        timeout_ms: 60_000, // 60 seconds
    };

    // Build and send transaction with custom options
    let signature = sender
        .build_and_send_transaction(vec![transfer_ix], &[&keypair], Some(options))
        .await?;

    // Or use default options
    // let signature = sender
    //     .build_and_send_transaction(vec![transfer_ix], &[&keypair], None)
    //     .await?;

    println!("Transaction confirmed: {}", signature);
    Ok(())
}
```

## Global Configuration Options

### RPC Configuration

```rust
// Must be explicitly set before sending transactions
set_rpc("https://api.mainnet-beta.solana.com").await?;
```

### Fee Configuration

```rust
// Dynamic priority fees based on network conditions
set_priority_fee_strategy(PriorityFeeStrategy::Dynamic {
    percentile: Percentile::P95,
    max_lamports: 1_000_000, // 1 SOL
})?;

// Fixed priority fee
// set_priority_fee_strategy(PriorityFeeStrategy::Exact(10_000))?;

// No priority fee
// set_priority_fee_strategy(PriorityFeeStrategy::Disabled)?;

// Configure Jito tips
set_jito_fee_strategy(JitoFeeStrategy::Dynamic {
    percentile: JitoPercentile::P50,
    max_lamports: 500_000, // 0.5 SOL
})?;

// Set compute unit margin multiplier (default: 1.1)
set_compute_unit_margin_multiplier(1.2)?;
```

### Transaction Options

Transaction options can be provided directly when sending:

```rust
// Create custom send options
let options = SendOptions {
    skip_preflight: false,
    commitment: CommitmentLevel::Confirmed,
    max_retries: 5,
    timeout_ms: 60_000, // 60 seconds
};

// Use with global configuration
let signature = build_and_send_transaction(
    instructions,
    signers,
    Some(options)
).await?;

// Or with a TransactionSender instance
let signature = sender
    .build_and_send_transaction(instructions, signers, Some(options))
    .await?;

// Use default options by passing None
let signature = build_and_send_transaction(instructions, signers, None).await?;
```

## Testing

All testing and example code is located in the `examples` directory. You can run the examples directly:

```bash
# Priority fees only (no Jito fees)
cargo run --example priority_only_test "https://api.devnet.solana.com"

# With Jito fees
cargo run --example with_jito_test "https://api.mainnet-beta.solana.com"
```

You can provide any custom RPC URL as a command-line argument. If no URL is provided,
the examples will default to using the Solana devnet URL.

## License

Orca License

See [LICENSE](../../LICENSE) for details.
