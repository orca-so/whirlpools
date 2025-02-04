use anchor_lang::prelude::*;
use crate::{math::sqrt_price_from_tick_index, state::{Oracle, VolatilityAdjustedFeeConstants, VolatilityAdjustedFeeVariables, Whirlpool, MAX_TICK_INDEX, MIN_TICK_INDEX, VA_FEE_CONTROL_FACTOR_DENOM, VOLATILITY_ACCUMULATOR_SCALE_FACTOR}};
use std::{
  cell::{Ref, RefMut},
};

// TODO: refacotor (may be moved to oracle.rs and Oracle account uses this ?)
#[derive(Debug, Default, Clone)]
pub struct VolatilityAdjustedFeeInfo {
  pub constants: VolatilityAdjustedFeeConstants,
  pub variables: VolatilityAdjustedFeeVariables,
}

// TODO: refactor (move to other file?)
// max fee rate should be controlled by max_volatility_accumulator, so this is a hard limit for safety
pub const TOTAL_FEE_RATE_HARD_LIMIT: u32 = 100_000; // 10%

pub fn compute_total_fee_rate(
  static_fee_rate: u16,
  va_fee_constants: &VolatilityAdjustedFeeConstants,
  va_fee_variables: &VolatilityAdjustedFeeVariables,
) -> u32 {
  let va_fee_rate = compute_va_fee_rate(va_fee_constants, va_fee_variables);
  let total_fee_rate = static_fee_rate as u32 + va_fee_rate;

  if total_fee_rate > TOTAL_FEE_RATE_HARD_LIMIT {
    TOTAL_FEE_RATE_HARD_LIMIT
  } else {
    total_fee_rate
  }
}

fn compute_va_fee_rate(
  va_fee_constants: &VolatilityAdjustedFeeConstants,
  va_fee_variables: &VolatilityAdjustedFeeVariables,
) -> u32 {
  // TODO: remove unwrap
  let crossed = va_fee_variables.volatility_accumulator.checked_mul(va_fee_constants.tick_group_size as u32).unwrap();
  let sqrd = u64::from(crossed) * u64::from(crossed);
  // TODO: use tight data type (u128 is required ?)
  ceil_div(
    u128::from(va_fee_constants.va_fee_control_factor) * u128::from(sqrd),
    u128::from(VA_FEE_CONTROL_FACTOR_DENOM) * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR) * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR),
  )
}

fn ceil_div(
  a: u128,
  b: u128,
) -> u32 {
  let q = (a + b - 1) / b;
  // TODO: remove unwrap
  q.try_into().unwrap()
}

pub fn load_va_fee_info<'info>(
  oracle: &UncheckedAccount<'info>,
) -> Result<Option<VolatilityAdjustedFeeInfo>> {
    use anchor_lang::Discriminator;

    let account_info = oracle.to_account_info();

    // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
    // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
    // So we need to handle uninitialized account manually.

    // account must be writable
    if !account_info.is_writable {
        return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
    }

    // uninitialized writable account (owned by system program and its data size is zero)
    if account_info.owner == &System::id() && account_info.data_is_empty() {
      // oracle is not initialized
        return Ok(None);
    }

    // owner program check
    if account_info.owner != &Oracle::owner() {
        return Err(
            Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                .with_pubkeys((*account_info.owner, Oracle::owner())),
        );
    }

    let data = account_info.try_borrow_data()?;
    if data.len() < Oracle::discriminator().len() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let disc_bytes = arrayref::array_ref![data, 0, 8];
    if disc_bytes != &Oracle::discriminator() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }

    let oracle: Ref<Oracle> = Ref::map(data, |data| {
        bytemuck::from_bytes(&data[8..std::mem::size_of::<Oracle>() + 8])
    });

    Ok(Some(VolatilityAdjustedFeeInfo {
        constants: oracle.va_fee_constants,
        variables: oracle.va_fee_variables,
    }))
}

pub fn update_va_fee_info<'info>(
  oracle: &UncheckedAccount<'info>,
  va_fee_info: &VolatilityAdjustedFeeInfo,
) -> Result<()> {
    use anchor_lang::Discriminator;

    let account_info = oracle.to_account_info();

    // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
    // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
    // So we need to handle uninitialized account manually.

    // TODO: remove duplicated check

    // account must be writable
    if !account_info.is_writable {
        return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
    }

    // uninitialized writable account (owned by system program and its data size is zero)
    if account_info.owner == &System::id() && account_info.data_is_empty() {
      // oracle is not initialized
        return Err(anchor_lang::error::ErrorCode::AccountNotInitialized.into());
    }

    // owner program check
    if account_info.owner != &Oracle::owner() {
        return Err(
            Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                .with_pubkeys((*account_info.owner, Oracle::owner())),
        );
    }

    let data = account_info.try_borrow_mut_data()?;
    if data.len() < Oracle::discriminator().len() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let disc_bytes = arrayref::array_ref![data, 0, 8];
    if disc_bytes != &Oracle::discriminator() {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }

    let mut oracle: RefMut<Oracle> = RefMut::map(data, |data| {
        bytemuck::from_bytes_mut(&mut data[8..std::mem::size_of::<Oracle>() + 8])
    });

    // TODO: separate constants update and variables update for safety
    // oracle.va_fee_constants = va_fee_info.constants;
    oracle.va_fee_variables = va_fee_info.variables;

    Ok(())
}


pub trait VolatilityAdjustedFeeManagerType {
  fn update_volatility_accumulator(&mut self) -> Result<()>;
  fn get_total_fee_rate(&self) -> u32;
  fn get_sqrt_price_boundary(&self, sqrt_price: u128) -> u128;
  fn advance_tick_group(&mut self);
  fn get_next_va_fee_info(&self) -> Option<VolatilityAdjustedFeeInfo>;
}



pub enum FeeRateManager {
  VolatilityAdjusted {
    a_to_b: bool,
    tick_group_index: i32,
    static_fee_rate: u16,
    va_fee_constants: VolatilityAdjustedFeeConstants,
    va_fee_variables: VolatilityAdjustedFeeVariables,  
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
    va_fee_info: Option<VolatilityAdjustedFeeInfo>,
  ) -> Self {
    match va_fee_info {
      None => {
        Self::Static {
          static_fee_rate,
        }
      }
      Some(va_fee_info) => {
        let tick_group_index = div_floor(current_tick_index, va_fee_info.constants.tick_group_size as i32);
        let va_fee_constants = va_fee_info.constants;
        let mut va_fee_variables = va_fee_info.variables;
    
        va_fee_variables.update_reference(tick_group_index, timestamp, &va_fee_constants);
    
        Self::VolatilityAdjusted {
          a_to_b,
          tick_group_index,
          static_fee_rate,
          va_fee_constants,
          va_fee_variables,
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
      Self::VolatilityAdjusted {
        tick_group_index,
        va_fee_constants,
        va_fee_variables,
        ..
      } => {
        va_fee_variables.update_volatility_accumulator(
          *tick_group_index,
          va_fee_constants,
        )
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
      Self::VolatilityAdjusted {
        static_fee_rate,
        va_fee_constants,
        va_fee_variables,
        ..
      } => {
        compute_total_fee_rate(
          *static_fee_rate,
          va_fee_constants,
          va_fee_variables,
        )
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
      Self::VolatilityAdjusted {
        a_to_b,
        tick_group_index,
        va_fee_constants,
        ..
      } => {
        let boundary_tick_index = if *a_to_b {
          *tick_group_index * va_fee_constants.tick_group_size as i32
        } else {
          *tick_group_index * va_fee_constants.tick_group_size as i32 + va_fee_constants.tick_group_size as i32
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

  pub fn advance_tick_group(&mut self) {
    match self {
      Self::Static {
        ..
      } => {
        // do nothing
      }
      Self::VolatilityAdjusted {
        a_to_b,
        tick_group_index,
        ..
      } => {
        *tick_group_index += if *a_to_b { -1 } else { 1 };
      },
    }
  }

  pub fn get_next_va_fee_info(&self) -> Option<VolatilityAdjustedFeeInfo> {
    match self {
      Self::Static {
        ..
      } => {
        None
      }
      Self::VolatilityAdjusted {
        va_fee_constants,
        va_fee_variables,
        ..
      } => {
        Some(VolatilityAdjustedFeeInfo {
          constants: *va_fee_constants,
          variables: *va_fee_variables,
        })
      },
    }
  }
}

fn div_floor(a: i32, b: i32) -> i32 {
  if a >= 0 {
    a / b
  } else {
    (a - b + 1) / b
  }
}