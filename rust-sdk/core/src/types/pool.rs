#![allow(non_snake_case)]

use crate::NUM_REWARDS;

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct WhirlpoolFacade {
    #[cfg_attr(feature = "wasm", tsify(type = "ReadonlyUint8Array"))]
    pub fee_tier_index_seed: [u8; 2],
    pub tick_spacing: u16,
    pub fee_rate: u16,
    pub protocol_fee_rate: u16,
    pub liquidity: u128,
    pub sqrt_price: u128,
    pub tick_current_index: i32,
    pub fee_growth_global_a: u128,
    pub fee_growth_global_b: u128,
    pub reward_last_updated_timestamp: u64,
    #[cfg_attr(feature = "wasm", tsify(type = "WhirlpoolRewardInfoFacade[]"))]
    pub reward_infos: [WhirlpoolRewardInfoFacade; NUM_REWARDS],
}

impl WhirlpoolFacade {
    pub fn fee_tier_index(&self) -> u16 {
        u16::from_le_bytes(self.fee_tier_index_seed)
    }

    pub fn is_initialized_with_adaptive_fee(&self) -> bool {
        self.fee_tier_index() != self.tick_spacing
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct WhirlpoolRewardInfoFacade {
    pub emissions_per_second_x64: u128,
    pub growth_global_x64: u128,
}
