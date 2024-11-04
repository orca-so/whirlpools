# Orca Whirlpools Core SDK

This package provides developers with advanced functionalities for interacting with the Whirlpool Program on Solana. The Core SDK offers convenient methods for math calculations, quotes, and other utilities, making it easier to manage complex liquidity and swap operations within Rust projects. It serves as the foundation for the High-Level SDK, providing key building blocks that enable developers to perform sophisticated actions while maintaining control over core details.

## Key Features

- **Math Library**: Contains a variety of functions for math operations related to bundles, positions, prices, ticks, and tokens, including calculations such as determining position status or price conversions.
- **Quote Library**: Provides utility functions for generating quotes, such as increasing liquidity, collecting fees or rewards, and swapping, enabling precise and optimized decision-making in liquidity management.

## Installation
```bash
cargo add orca_whirlpools_core
```

## Usage
Here are some basic examples of how to use the package:

### Math Example
The following example demonstrates how to use the `is_position_in_range` function to determine whether a position is currently in range.

```rust
use orca_whirlpools_core::is_position_in_range;

fn main() {
    let current_sqrt_price = 7448043534253661173u128;
    let tick_index_1 = -18304;
    let tick_index_2 = -17956;

    let in_range = is_position_in_range(current_sqrt_price.into(), tick_index_1, tick_index_2);
    println!("Position in range? {:?}", in_range);
}
```

Expected output:
```
Position in range? true
```

### Quote Example

The following example demonstrates how to use the increase_liquidity_quote_a function to calculate a quote for increasing liquidity given a token A amount.

```rust
use orca_whirlpools_core::increase_liquidity_quote_a;
use orca_whirlpools_core::TransferFee;

fn main() {
    let token_amount_a = 1000000000u64;
    let slippage_tolerance_bps = 100u16;
    let current_sqrt_price = 7437568627975669726u128;
    let tick_index_1 = -18568;
    let tick_index_2 = -17668;
    let transfer_fee_a = Some(TransferFee::new(200));
    let transfer_fee_b = None;

    let quote = increase_liquidity_quote_a(
        token_amount_a,
        slippage_tolerance_bps,
        current_sqrt_price.into(),
        tick_index_1,
        tick_index_2,
        transfer_fee_a,
        transfer_fee_b,
    ).unwrap();
    
    println!("{:?}", quote);
}
```

Expected output:
```
IncreaseLiquidityQuote {
    liquidity_delta: 16011047470,
    token_est_a: 1000000000,
    token_est_b: 127889169,
    token_max_a: 1010000000,
    token_max_b: 129168061,
}
```