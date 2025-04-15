#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct OracleFacade {
  pub trade_enable_timestamp: u64,
  pub adaptive_fee_constants: AdaptiveFeeConstantsFacade,
  pub adaptive_fee_variables: AdaptiveFeeVariablesFacade,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct AdaptiveFeeConstantsFacade {
    pub filter_period: u16,
    pub decay_period: u16,
    pub reduction_factor: u16,
    pub adaptive_fee_control_factor: u32,
    pub max_volatility_accumulator: u32,
    pub tick_group_size: u16,
    pub major_swap_threshold_ticks: u16,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct AdaptiveFeeVariablesFacade {
    pub last_reference_update_timestamp: u64,
    pub last_major_swap_timestamp: u64,
    pub volatility_reference: u32,
    pub tick_group_index_reference: i32,
    pub volatility_accumulator: u32,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct AdaptiveFeeInfo {
  pub constants: AdaptiveFeeConstantsFacade,
  pub variables: AdaptiveFeeVariablesFacade,
}

impl From<OracleFacade> for AdaptiveFeeInfo {
  fn from(oracle: OracleFacade) -> Self {
    AdaptiveFeeInfo {
      constants: oracle.adaptive_fee_constants,
      variables: oracle.adaptive_fee_variables,
    }
  }
}
