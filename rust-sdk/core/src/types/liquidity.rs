#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]

pub struct DecreaseLiquidityQuote {
    pub liquidity_delta: u128,
    pub token_est_a: u64,
    pub token_est_b: u64,
    pub token_min_a: u64,
    pub token_min_b: u64,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]

pub struct IncreaseLiquidityQuote {
    pub liquidity_delta: u128,
    pub token_est_a: u64,
    pub token_est_b: u64,
    pub token_max_a: u64,
    pub token_max_b: u64,
}

/// Contains the token amounts for a position
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct PositionTokenAmounts {
    pub token_a: u64,
    pub token_b: u64,
}
