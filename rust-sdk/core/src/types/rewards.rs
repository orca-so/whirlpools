#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct CollectRewardsQuote {
    pub reward_owed_1: u64,
    pub reward_owed_2: u64,
    pub reward_owed_3: u64,
}
