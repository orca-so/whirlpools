#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

/// The denominator of the fee rate value.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub const FEE_RATE_DENOMINATOR: u32 = 1_000_000;

// TODO: WASM export (which doesn't work with u128 yet)

/// The minimum sqrt price for a whirlpool.
pub const MIN_SQRT_PRICE: u128 = 4295048016;

/// The maximum sqrt price for a whirlpool.
pub const MAX_SQRT_PRICE: u128 = 79226673515401279992447579055;
