# LP Bot - position rebalance
A Rust-based CLI bot for interacting with the Orca Whirlpools program on Solana. This bot monitors and rebalances a liquidity position by closing and reopening positions when price deviations exceed a user-defined threshold.

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
1. Clone this repository:
  ```bash
  git clone https://github.com/orca-so/whirlpools.git
  cd examples/rust-sdk/lp-bot
  ```
2. Build the bot:
  ```bash
  cargo build --release
  ```
3. The executable will be located in target/release/lp-bot

---

## RPC Configuration
The bot connects to Solana Mainnet Beta by default using:

```rust
const RPC_URL: &str = "https://api.mainnet-beta.solana.com";
```

To modify this, update the RPC_URL constant in main.rs.

---

## Usage
Run the bot with the following arguments
```bash
./target/release/lp-bot \
  --position-mint-address <POSITION_MINT_ADDRESS> \
  --threshold <THRESHOLD_PERCENTAGE> \
  --interval <INTERVAL_IN_SECONDS> \
  --priority-fee-tier <PRIORITY_FEE_TIER>
```

### Arguments
- `--position-mint-address` (required): The mint address of the position to monitor and rebalance.
- `--threshold` (optional): The percentage deviation from the center price at which rebalancing is triggered. Default: 1.0.
- `--interval` (optional): The time interval (in seconds) between checks. Default: 60.
- `--priority-fee-tier` (optional): The priority fee tier for transaction processing. Options:
  - `none`: No priority fee.
  - `low`: Lower 25th quartile prioritization fee.
  - `medium`: Median prioritization fee (default).
  - `high`: Upper 75th quartile prioritization fee.
  - `turbo`: Upper 95th quartile prioritization fee.
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
  --threshold 0.5 \
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
    └── lp-bot/
        └── src/
            ├── main.rs                 # Entry point
            ├── cli.rs                  # CLI argument parsing
            ├── wallet.rs               # Wallet management
            ├── position_manager.rs     # Position monitoring and rebalancing
            ├── solana_utils.rs         # RPC utilities
```