#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[cfg(any(feature = "wasm", test))]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct WhirlpoolFacade {
    pub tick_spacing: u16,
    pub fee_rate: u16,
    pub liquidity: u128,
    pub sqrt_price: u128,
    pub tick_current_index: i32,
    pub fee_growth_global_a: u128,
    pub fee_growth_global_b: u128,
    pub reward_last_updated_timestamp: u64,
    pub reward_infos: [WhirlpoolRewardInfoFacade; 3],
}

#[cfg(any(feature = "wasm", test))]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct WhirlpoolRewardInfoFacade {
    pub emissions_per_second_x64: u128,
    pub growth_global_x64: u128,
}

#[cfg(not(any(feature = "wasm", test)))]
pub use orca_whirlpools_client::accounts::Whirlpool as WhirlpoolFacade;
