#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]

pub struct ExactInSwapQuote {
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_in: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_est_out: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_min_out: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub total_fee: u64,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]

pub struct ExactOutSwapQuote {
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_out: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_est_in: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub token_max_in: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub total_fee: u64,
}
