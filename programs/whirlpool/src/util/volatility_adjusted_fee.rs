use crate::state::{VolatilityAdjustedFeeConstants, VolatilityAdjustedFeeVariables, Whirlpool, VA_FEE_CONTROL_FACTOR_DENOM, VOLATILITY_ACCUMULATOR_SCALE_FACTOR};

// TODO: refacotor (may be moved to oracle.rs and Oracle account uses this ?)
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
