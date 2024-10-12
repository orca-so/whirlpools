#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use serde_big_array::BigArray;

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[cfg(any(feature = "wasm", test))]
use crate::TICK_ARRAY_SIZE;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub struct TickRange {
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
}

#[cfg(any(feature = "wasm", test))]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct TickFacade {
    pub initialized: bool,
    pub liquidity_net: i128,
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint[]"))]
    pub reward_growths_outside: [u128; 3],
}

#[cfg(not(any(feature = "wasm", test)))]
pub use orca_whirlpools_client::types::Tick as TickFacade;

#[cfg(any(feature = "wasm", test))]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct TickArrayFacade {
    pub start_tick_index: i32,
    #[cfg_attr(feature = "wasm", serde(with = "BigArray"))]
    pub ticks: [TickFacade; TICK_ARRAY_SIZE],
}

#[cfg(not(any(feature = "wasm", test)))]
pub use orca_whirlpools_client::accounts::TickArray as TickArrayFacade;
