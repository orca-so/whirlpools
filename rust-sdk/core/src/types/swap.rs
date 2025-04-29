#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]

pub struct ExactInSwapQuote {
    pub token_in: u64,
    pub token_est_out: u64,
    pub token_min_out: u64,
    pub trade_fee: u64,
    pub trade_fee_rate_min: u32,
    pub trade_fee_rate_max: u32,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]

pub struct ExactOutSwapQuote {
    pub token_out: u64,
    pub token_est_in: u64,
    pub token_max_in: u64,
    pub trade_fee: u64,
    pub trade_fee_rate_min: u32,
    pub trade_fee_rate_max: u32,
}
