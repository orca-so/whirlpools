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

### Basic Example

```rust
use orca_tx_sender::{
    build_and_send_transaction,
    PriorityFeeStrategy, Percentile, SendOptions,
    set_priority_fee_strategy, set_rpc, get_rpc_client
};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::system_instruction;
use solana_sdk::commitment_config::CommitmentLevel;
use std::error::Error;
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize RPC configuration (required!)
    set_rpc("https://api.mainnet-beta.solana.com").await?;

    // Check connection
    let client = get_rpc_client()?;
    println!("Connected to Solana");

    // Configure priority fees
    set_priority_fee_strategy(PriorityFeeStrategy::Dynamic {
        percentile: Percentile::P95,
        max_lamports: 10_000,
    })?;

    // Create a keypair for signing
    let payer = Keypair::new();
    println!("Using keypair: {}", payer.pubkey());

    // Check balance
    let balance = client.get_balance(&payer.pubkey()).await?;
    println!("Account balance: {} lamports", balance);

    // Jupiter Program address as an example recipient
    let recipient = Pubkey::from_str("JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo").unwrap();

    // Create transfer instruction
    let transfer_ix = system_instruction::transfer(
        &payer.pubkey(),
        &recipient,
        1_000_000, // 0.001 SOL
    );

    // Custom send options
    let options = SendOptions {
        commitment: CommitmentLevel::Confirmed,
        timeout_ms: 60_000, // 60 seconds
    };

    // Build and send transaction
    println!("Sending transaction...");
    let signature = build_and_send_transaction(
        vec![transfer_ix],
        &[&payer],
        Some(options),
        None, // No address lookup tables
    ).await?;

    println!("Transaction sent: {}", signature);
    Ok(())
}
```

### Example With Jito Fees

```rust
use orca_tx_sender::{
    build_and_send_transaction,
    JitoFeeStrategy, Percentile, JitoPercentile, PriorityFeeStrategy, SendOptions,
    set_priority_fee_strategy, set_jito_fee_strategy, set_compute_unit_margin_multiplier,
    set_jito_block_engine_url, set_rpc, get_rpc_client
};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::system_instruction;
use solana_sdk::commitment_config::CommitmentLevel;
use std::error::Error;
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize RPC configuration (required!)
    set_rpc("https://api.mainnet-beta.solana.com").await?;

    // Check connection
    let client = get_rpc_client()?;
    println!("Connected to Solana");

    // Configure fee settings with dynamic priority fees and Jito fees
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

    // Create a keypair for signing
    let payer = Keypair::new();
    println!("Using keypair: {}", payer.pubkey());

    // Check balance
    let balance = client.get_balance(&payer.pubkey()).await?;
    println!("Account balance: {} lamports", balance);

    // Jupiter Program address as an example recipient
    let recipient = Pubkey::from_str("JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo").unwrap();

    // Create transfer instruction
    let transfer_ix = system_instruction::transfer(
        &payer.pubkey(),
        &recipient,
        1_000_000, // 0.001 SOL
    );

    // Custom send options
    let options = SendOptions {
        commitment: CommitmentLevel::Confirmed,
        timeout_ms: 60_000, // 60 seconds
    };

    // Build and send transaction
    println!("Sending transaction with priority fees and Jito fees...");
    let signature = build_and_send_transaction(
        vec![transfer_ix],
        &[&payer],
        Some(options),
        None, // No address lookup tables
    ).await?;

    println!("Transaction sent: {}", signature);
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
    commitment: CommitmentLevel::Confirmed,
    timeout_ms: 60_000, // 60 seconds
};

// Use with global configuration
let signature = build_and_send_transaction(
    instructions,
    signers,
    Some(options),
    None, // No address lookup tables
).await?;

// With address lookup tables for account compression
let signature = build_and_send_transaction(
    instructions,
    signers,
    Some(options),
    Some(address_lookup_tables), // With ALTs
).await?;

// Use default options by passing None
let signature = build_and_send_transaction(
    instructions,
    signers,
    None,
    None,
).await?;
```

## Testing

All testing and example code is located in the `examples` directory. You can run the examples directly:

```bash
# Priority fees only (no Jito fees)
cargo run --example priority_only_test "https://api.devnet.solana.com"

# With Jito fees
cargo run --example with_jito_test "https://api.mainnet-beta.solana.com"

# With address lookup tables
cargo run --example with_lookup_tables "https://api.mainnet-beta.solana.com"
```

You can provide any custom RPC URL as a command-line argument. If no URL is provided,
the examples will default to using the Solana devnet URL.

## License

Orca License

See [LICENSE](../../LICENSE) for details.
