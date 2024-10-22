#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use crate::NUM_REWARDS;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct PositionRatio {
    pub ratio_a: u16,
    pub ratio_b: u16,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub enum PositionStatus {
    PriceInRange,
    PriceBelowRange,
    PriceAboveRange,
    Invalid,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct PositionFacade {
    pub liquidity: u128,
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub fee_growth_checkpoint_a: u128,
    pub fee_owed_a: u64,
    pub fee_growth_checkpoint_b: u128,
    pub fee_owed_b: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "PositionRewardInfoFacade[]"))]
    pub reward_infos: [PositionRewardInfoFacade; NUM_REWARDS],
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct PositionRewardInfoFacade {
    pub growth_inside_checkpoint: u128,
    pub amount_owed: u64,
}
