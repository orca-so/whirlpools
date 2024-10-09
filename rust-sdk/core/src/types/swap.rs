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
    pub token_in: u128,
    pub token_est_out: u128,
    pub token_min_out: u128,
    pub total_fee: u128,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]

pub struct ExactOutSwapQuote {
    pub token_out: u128,
    pub token_est_in: u128,
    pub token_max_in: u128,
    pub total_fee: u128,
}
