# Whirlpool Repositioning Bot

A Rust-based CLI bot for interacting with the Orca Whirlpools program on Solana. This bot monitors and rebalances a liquidity position by closing and reopening positions when price deviations exceed a user-defined threshold.

> NOTE: this example works with SPL tokens only. If you want to use the repositioning bot on pools where tokens are paired with SOL, you should ensure that you have wSOL (`So11111111111111111111111111111111111111112`) available in your wallet. Check out [this guide](https://solana.com/developers/cookbook/tokens/manage-wrapped-sol) on how to use wSOL.

---

## Features

- **Automated Position Monitoring**: Monitors price deviation of a liquidity position on Orca Whirlpool by calculating the center of the position's price range and comparing it to the current pool price. If the deviation exceeds the specified threshold (in percentage), the bot initiates rebalancing.
- **Automated Rebalancing**: Closes and reopens liquidity positions by centering the new position around the current pool price, maintaining the same width (distance between the lower and upper price bounds) as the initial position.
- **Customizable Priority Fees**: Integrates compute budget priority fees to enhance transaction speed and landing, with options ranging from `none` to `turbo` for different levels of prioritization.

---

## Prerequisites

1. **Solana Wallet**:

- Place a `wallet.json` file in the working directory with the keypair that owns the positions.
- Ensure the wallet has sufficient funds for transactions.

2. **Existing Position**:

- You must have an active position on Orca Whirlpools. You can open a position using our SDKs or through our UI at https://www.orca.so/pools.

3. **Rust**:

- Install Rust using [rustup](https://rustup.rs/).

---

## Installation

There are two ways of building and using this example.

### 1. Build Whirlpools repo

First, clone the repository:

```bash
git clone https://github.com/orca-so/whirlpools.git
```

Then, build the repository from the root of the repository:

```bash
yarn build
```

> Note: if you experience any issues during the build process, consult the [README](../../../README.md) at the root of the repository.

### 2. Build the example project only:

First, clone the repo and `cd` into the directory of this project.

```bash
git clone https://github.com/orca-so/whirlpools.git
cd examples/rust-sdk/whirlpool_repositioning_bot
```

Then, update `Cargo.toml`. This project uses the local version of the dependencies. If you want to move this example project outside of this repo, update the `Cargo.toml` as follows:

```toml
# other dependencies
orca_whirlpools = { version = "^2.0" }
orca_whirlpools_client = { version = "^2.0" }
orca_whirlpools_core = { version = "^2.0" }
# rest of the dependencies
```

Build the bot:

```bash
cargo build --release
```

The executable will be located in target/release/whirlpool_repositioning_bot

---

## RPC Configuration

The bot connects to an SVM network by using an RPC URL. Make a local copy of `.env.template` to `.env` and set your RPC URL there. It is strongly recommended to you use a URL from an RPC provider, or your own RPC node.

```bash
RPC_URL="https://your-rpc-url.com"
```

---

## Usage

Run the bot with the following arguments

```bash
./target/release/lp-bot \
  --position-mint-address <POSITION_MINT_ADDRESS> \
  --threshold <THRESHOLD_BPS> \
  --interval <INTERVAL_IN_SECONDS> \
  --priority-fee-tier <PRIORITY_FEE_TIER> \
  --max-priority-fee-lamports <MAX_PRIORITY_FEE_LAMPORTS> \
  --slippage-tolerance-bps <SLIPPAGE_TOLERANCE_BPS>
```

### Arguments

- `--position-mint-address` (required): The mint address of the position to monitor and rebalance.
- `--threshold` (optional): TThe threshold for triggering rebalancing, defined by how far the position's center deviates from the current price. Default: 100.
- `--interval` (optional): The time interval (in seconds) between checks. Default: 60.
- `--priority-fee-tier` (optional): The priority fee tier for transaction processing. Options:
  - `none`: No priority fee.
  - `low`: Lower 25th quartile prioritization fee.
  - `medium`: Median prioritization fee (default).
  - `high`: Upper 80th quartile prioritization fee.
  - `turbo`: Upper 99th quartile prioritization fee.
- `max_priority_fee_lamports` (optional): Maximum total priority fee in lamports. Default: 10_000_000 (0.01 SOL).
- `slippage_tolerance_bps` (optional): Slippage tolerance in basis points (bps). Default: 100.

### Example Usage

Monitor and rebalance with default settings:

```bash
./target/release/lp-bot \
  --position-mint-address 5m1izNWC3ioBaKm63e3gSNFeZ44o13ncre5QknTXBJUS
```

Monitor with custom threshold and interval:

```bash
./target/release/lp-bot \
  --position-mint-address 5m1izNWC3ioBaKm63e3gSNFeZ44o13ncre5QknTXBJUS \
  --threshold 50 \
  --interval 30
```

Monitor with turbo priority fees:

```bash
./target/release/lp-bot \
  --position-mint-address 5m1izNWC3ioBaKm63e3gSNFeZ44o13ncre5QknTXBJUS \
  --priority-fee-tier turbo
```

---

## Directory Structure

```bash
examples/
├── rust-sdk/
    └── whirlpool_repositioning_bot/
        └── src/
            ├── main.rs                 # Entry point
            ├── cli.rs                  # CLI argument parsing
            ├── wallet.rs               # Wallet management
            ├── position_manager.rs     # Position monitoring and rebalancing
            ├── solana_utils.rs         # RPC utilities
```
