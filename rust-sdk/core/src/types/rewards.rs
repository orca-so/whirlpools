#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]

pub struct CollectRewardsQuote {
    pub reward_owed_1: u128,
    pub reward_owed_2: u128,
    pub reward_owed_3: u128,
}
