#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::NUM_REWARDS;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct CollectRewardsQuote {
    pub rewards: [CollectRewardQuote; NUM_REWARDS],
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct CollectRewardQuote {
    pub rewards_owed: u64,
}
