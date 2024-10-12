#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

use crate::NUM_REWRARDS;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub struct PositionRatio {
    pub ratio_a: u16,
    pub ratio_b: u16,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub enum PositionStatus {
    PriceInRange,
    PriceBelowRange,
    PriceAboveRange,
    Invalid,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct PositionFacade {
    pub liquidity: u128,
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub fee_growth_checkpoint_a: u128,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub fee_owed_a: u64,
    pub fee_growth_checkpoint_b: u128,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub fee_owed_b: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "PositionRewardInfoFacade[]"))]
    pub reward_infos: [PositionRewardInfoFacade; NUM_REWRARDS],
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct PositionRewardInfoFacade {
    pub growth_inside_checkpoint: u128,
    #[cfg_attr(feature = "wasm", serde(with = "crate::types::u64"))]
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
    pub amount_owed: u64,
}
