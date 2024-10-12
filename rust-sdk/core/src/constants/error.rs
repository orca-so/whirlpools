#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_const;

pub type ErrorCode = u16;

#[cfg_attr(feature = "wasm", wasm_const)]
pub const TICK_ARRAY_NOT_EVENLY_SPACED: ErrorCode = 9000;

#[cfg_attr(feature = "wasm", wasm_const)]
pub const TICK_INDEX_OUT_OF_BOUNDS: ErrorCode = 9001;

#[cfg_attr(feature = "wasm", wasm_const)]
pub const INVALID_TICK_INDEX: ErrorCode = 9002;

#[cfg_attr(feature = "wasm", wasm_const)]
pub const ARITHMETIC_OVERFLOW: ErrorCode = 9003;

#[cfg_attr(feature = "wasm", wasm_const)]
pub const AMOUNT_EXCEEDS_MAX_U64: ErrorCode = 9004;

#[cfg_attr(feature = "wasm", wasm_const)]
pub const SQRT_PRICE_OUT_OF_BOUNDS: ErrorCode = 9005;
