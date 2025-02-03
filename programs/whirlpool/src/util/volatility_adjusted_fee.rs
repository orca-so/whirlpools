use anchor_lang::prelude::*;
use crate::state::{Oracle, VolatilityAdjustedFeeConstants, VolatilityAdjustedFeeVariables, Whirlpool, VA_FEE_CONTROL_FACTOR_DENOM, VOLATILITY_ACCUMULATOR_SCALE_FACTOR};
use std::{
  cell::{Ref, RefMut},
};

// TODO: refacotor (may be moved to oracle.rs and Oracle account uses this ?)
#[derive(Debug, Default)]
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

pub struct TickGroup {
  tick_group_size: u16,
  a_to_b: bool,
  tick_group_index: i32,
}

impl TickGroup {
  pub fn new(tick_group_size: u16, a_to_b: bool, current_tick_index: i32) -> Self {
    let tick_group_index = div_floor(current_tick_index, tick_group_size as i32);
    Self {
      tick_group_size,
      a_to_b,
      tick_group_index,
    }
  }

  pub fn tick_group_index(&self) -> i32 {
    self.tick_group_index
  }

  pub fn tick_group_next_boundary_tick_index(&self) -> i32 {
    if self.a_to_b {
      self.tick_group_index * self.tick_group_size as i32
    } else {
      self.tick_group_index * self.tick_group_size as i32 + self.tick_group_size as i32
    }
  }

  pub fn next(&mut self) {
    self.tick_group_index += if self.a_to_b { -1 } else { 1 };
  }
}

fn div_floor(a: i32, b: i32) -> i32 {
  if a >= 0 {
    a / b
  } else {
    (a - b + 1) / b
  }
}