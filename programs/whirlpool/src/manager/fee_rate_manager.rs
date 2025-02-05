use anchor_lang::prelude::*;
use crate::{math::sqrt_price_from_tick_index, state::{AdaptiveFeeConstants, AdaptiveFeeVariables, MAX_TICK_INDEX, MIN_TICK_INDEX}};

pub const VOLATILITY_ACCUMULATOR_SCALE_FACTOR: u16 = 10_000;
pub const MAX_REDUCTION_FACTOR: u16 = 10_000;

pub const ADAPTIVE_FEE_CONTROL_FACTOR_DENOM: u32 = 100_000;

// max fee rate should be controlled by max_volatility_accumulator, so this is a hard limit for safety
pub const TOTAL_FEE_RATE_HARD_LIMIT: u32 = 100_000; // 10%


// TODO: refacotor (may be moved to oracle.rs and Oracle account uses this ?)
#[derive(Debug, Default, Clone)]
pub struct AdaptiveFeeInfo {
  pub constants: AdaptiveFeeConstants,
  pub variables: AdaptiveFeeVariables,
}

pub enum FeeRateManager {
  Adaptive {
    a_to_b: bool,
    tick_group_index: i32,
    static_fee_rate: u16,
    adaptive_fee_constants: AdaptiveFeeConstants,
    adaptive_fee_variables: AdaptiveFeeVariables,  
  },
  Static {
    static_fee_rate: u16,
  },
}

impl FeeRateManager {
  pub fn new(
    a_to_b: bool,
    current_tick_index: i32,
    timestamp: i64,
    static_fee_rate: u16,
    adaptive_fee_info: Option<AdaptiveFeeInfo>,
  ) -> Self {
    match adaptive_fee_info {
      None => {
        Self::Static {
          static_fee_rate,
        }
      }
      Some(adaptive_fee_info) => {
        let tick_group_index = div_floor(current_tick_index, adaptive_fee_info.constants.tick_group_size as i32);
        let adaptive_fee_constants = adaptive_fee_info.constants;
        let mut adaptive_fee_variables = adaptive_fee_info.variables;
    
        adaptive_fee_variables.update_reference(tick_group_index, timestamp, &adaptive_fee_constants);
    
        Self::Adaptive {
          a_to_b,
          tick_group_index,
          static_fee_rate,
          adaptive_fee_constants,
          adaptive_fee_variables,
        }
      }
    }
  }

  pub fn update_volatility_accumulator(&mut self) -> Result<()> {
    match self {
      Self::Static {
        ..
      } => {
        Ok(())
      }
      Self::Adaptive {
        tick_group_index,
        adaptive_fee_constants,
        adaptive_fee_variables,
        ..
      } => {
        adaptive_fee_variables.update_volatility_accumulator(
          *tick_group_index,
          adaptive_fee_constants,
        )
      },
    }
  }

  pub fn advance_tick_group(&mut self) {
    match self {
      Self::Static {
        ..
      } => {
        // do nothing
      }
      Self::Adaptive {
        a_to_b,
        tick_group_index,
        ..
      } => {
        *tick_group_index += if *a_to_b { -1 } else { 1 };
      },
    }
  }

  pub fn get_total_fee_rate(&self) -> u32 {
    match self {
      Self::Static {
        static_fee_rate,
      } => {
        *static_fee_rate as u32
      }
      Self::Adaptive {
        static_fee_rate,
        adaptive_fee_constants,
        adaptive_fee_variables,
        ..
      } => {
        let adaptive_fee_rate = Self::compute_adaptive_fee_rate(adaptive_fee_constants, adaptive_fee_variables);
        let total_fee_rate = *static_fee_rate as u32 + adaptive_fee_rate;
      
        if total_fee_rate > TOTAL_FEE_RATE_HARD_LIMIT {
          TOTAL_FEE_RATE_HARD_LIMIT
        } else {
          total_fee_rate
        }
      },
    }
  }

  pub fn get_bounded_sqrt_price_target(&self, sqrt_price: u128) -> u128 {
    match self {
      Self::Static {
        ..
      } => {
        sqrt_price
      }
      Self::Adaptive {
        a_to_b,
        tick_group_index,
        adaptive_fee_constants,
        ..
      } => {
        let boundary_tick_index = if *a_to_b {
          *tick_group_index * adaptive_fee_constants.tick_group_size as i32
        } else {
          *tick_group_index * adaptive_fee_constants.tick_group_size as i32 + adaptive_fee_constants.tick_group_size as i32
        };

        let boundary_sqrt_price = sqrt_price_from_tick_index(
          boundary_tick_index.clamp(MIN_TICK_INDEX, MAX_TICK_INDEX)
        );

        if *a_to_b {
          sqrt_price.max(boundary_sqrt_price)
        } else {
          sqrt_price.min(boundary_sqrt_price)
        }
      },
    }
  }

  pub fn get_next_adaptive_fee_info(&self) -> Option<AdaptiveFeeInfo> {
    match self {
      Self::Static {
        ..
      } => {
        None
      }
      Self::Adaptive {
        adaptive_fee_constants,
        adaptive_fee_variables,
        ..
      } => {
        Some(AdaptiveFeeInfo {
          constants: *adaptive_fee_constants,
          variables: *adaptive_fee_variables,
        })
      },
    }
  }

  fn compute_adaptive_fee_rate(
    adaptive_fee_constants: &AdaptiveFeeConstants,
    adaptive_fee_variables: &AdaptiveFeeVariables,
  ) -> u32 {
    // TODO: remove unwrap
    let crossed = adaptive_fee_variables.volatility_accumulator.checked_mul(adaptive_fee_constants.tick_group_size as u32).unwrap();
    let sqrd = u64::from(crossed) * u64::from(crossed);
    // TODO: use tight data type (u128 is required ?)
    div_ceil(
      u128::from(adaptive_fee_constants.adaptive_fee_control_factor) * u128::from(sqrd),
      u128::from(ADAPTIVE_FEE_CONTROL_FACTOR_DENOM) * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR) * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR),
    )
  }  
}

fn div_ceil(
  a: u128,
  b: u128,
) -> u32 {
  let q = (a + b - 1) / b;
  // TODO: remove unwrap
  q.try_into().unwrap()
}

fn div_floor(a: i32, b: i32) -> i32 {
  if a >= 0 {
    a / b
  } else {
    (a - b + 1) / b
  }
}
