#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]

pub struct DecreaseLiquidityQuote {
    pub liquidity_delta: u128,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_est_a: u64,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_est_b: u64,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_min_a: u64,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_min_b: u64,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]

pub struct IncreaseLiquidityQuote {
    pub liquidity_delta: u128,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_est_a: u64,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_est_b: u64,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_max_a: u64,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_max_b: u64,
}
