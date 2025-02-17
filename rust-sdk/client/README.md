# Orca Whirlpools Client SDK

## Overview
This package provides developers with low-level functionalities for interacting with the Whirlpool Program on Solana. It serves as a foundational tool that allows developers to manage and integrate detailed operations into their Rust projects, particularly those related to Orca's Whirlpool Program. This package offers granular control for advanced use cases.

## Compatibiltiy
- Compatible with `anchor` versions `^0.26` but `<0.30`. If you enable the `anchor` feature of `orca_whirlpools_client` in `cargo.toml` while using a version of anchor that's `^0.30` in your project, you may need to apply a lockfile patch to switch to a lower version:
    ```bash
    cargo update anchor:<current-version> --precise 0.29
    ```
- Compatible with `solana-program` versions `^1.18.0` but `<3.0.0`. By default, Cargo will install the latest version of Solana SDK `^v2`. This can cause dependcy issues when using older versions. To solve this you can apply a lockfile patch with the following command:
    ```bash
    cargo update solana-program:<current-version> --precise <required-version>
    ```
- NOTE: if you are dealing with compatibility issues for both `anchor` and `solana-program`, the order of the patches matters. First patch `anchor`, then patch `solana-program`.

## Key Features
- **Codama Client**: The package includes a set of generated client code based on the Whirlpool Program IDL. This ensures all the necessary program information is easily accessible in a structured format. It handles all decoding and encoding of instructions and account data, making it much easier to interact with the program.
- **PDA (Program Derived Addresses) Utilities**: This feature contains utility functions that help derive Program Derived Addresses (PDAs) for accounts within the Whirlpool Program, simplifying address derivation for developers.

## Installation
```bash
cargo add orca_whirlpools_client
```

## Usage
Here are some basic examples of how to use the package:

### Deriving a PDA
To derive a PDA for a Whirlpool account, you can use the `get_whirlpool_address` PDA utility.

```rust
use orca_whirlpools_client::get_whirlpool_address;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

fn main() {
    let whirlpool_config_address = Pubkey::from_str("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR").unwrap();
    let token_mint_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(); // wSOL
    let token_mint_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // DevUSDC
    let tick_spacing = 64;

    let (whirlpool_pda, _bump) = get_whirlpool_address(&whirlpool_config_address, &token_mint_a, &token_mint_b, tick_spacing).unwrap();
    println!("{:?}", whirlpool_pda);
}
```

### Example: Initialize Pool Instruction

The following example demonstrates how to create an `InitializePool` instruction:

```rust
use orca_whirlpools_client::{
    instructions::InitializePoolV2Builder,
    get_fee_tier_address,
    get_token_badge_address,
    get_whirlpool_address,
};
use solana_sdk::{
    pubkey::Pubkey,
    signer::{keypair::Keypair, Signer},
};
use std::str::FromStr;

fn main() {
    let whirlpool_config_address = Pubkey::from_str("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR").unwrap();
    let token_mint_a = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(); // wSOL
    let token_mint_b = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap(); // DevUSDC
    let (token_badge_a, _bump) = get_token_badge_address(&whirlpool_config_address, &token_mint_a).unwrap();
    let (token_badge_b, _bump) = get_token_badge_address(&whirlpool_config_address, &token_mint_b).unwrap();
    let wallet = Keypair::new(); // CAUTION: this wallet is not persistent
    let tick_spacing = 8;
    let (whirlpool_pda, _bump) = get_whirlpool_address(&whirlpool_config_address, &token_mint_a, &token_mint_b, tick_spacing).unwrap();
    let token_vault_a = Keypair::new();
    let token_vault_b = Keypair::new();
    let (fee_tier, _bump) = get_fee_tier_address(&whirlpool_config_address, tick_spacing).unwrap();
    let token_program_a = Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap();
    let token_program_b = Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap();
    let initial_sqrt_price = 7459106261056563200u128;    

    let initialize_pool_v2_instruction = InitializePoolV2Builder::new()
        .whirlpools_config(whirlpool_config_address)
        .token_mint_a(token_mint_a)
        .token_mint_b(token_mint_b)
        .token_badge_a(token_badge_a)
        .token_badge_b(token_badge_b)
        .funder(wallet.pubkey())
        .whirlpool(whirlpool_pda)
        .token_vault_a(token_vault_a.pubkey())
        .token_vault_b(token_vault_b.pubkey())
        .fee_tier(fee_tier)
        .token_program_a(token_program_a)
        .token_program_b(token_program_b)
        .tick_spacing(tick_spacing)
        .initial_sqrt_price(initial_sqrt_price)
        .instruction();

    println!("{:?}", initialize_pool_v2_instruction);
}
```