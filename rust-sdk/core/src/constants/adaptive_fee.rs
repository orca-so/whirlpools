#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

/// This constant is used to scale the value of the volatility accumulator.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub const VOLATILITY_ACCUMULATOR_SCALE_FACTOR: u16 = 10_000;

/// The denominator of the reduction factor.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub const REDUCTION_FACTOR_DENOMINATOR: u16 = 10_000;

/// adaptive_fee_control_factor is used to map the square of the volatility accumulator to the fee rate.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub const ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR: u32 = 100_000;

/// The time (in seconds) to forcibly reset the reference if it is not updated for a long time.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub const MAX_REFERENCE_AGE: u64 = 3_600;

/// max fee rate should be controlled by max_volatility_accumulator, so this is a hard limit for safety.
/// Fee rate is represented as hundredths of a basis point.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub const FEE_RATE_HARD_LIMIT: u32 = 100_000; // 10%
