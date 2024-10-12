#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_const;

/// The denominator of the fee rate value.
#[cfg_attr(feature = "wasm", wasm_const)]
pub const FEE_RATE_DENOMINATOR: u32 = 1_000_000;
