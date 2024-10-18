#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

pub type ErrorCode = u16;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_ARRAY_NOT_EVENLY_SPACED: ErrorCode = 9000;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_INDEX_OUT_OF_BOUNDS: ErrorCode = 9001;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_TICK_INDEX: ErrorCode = 9002;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const ARITHMETIC_OVERFLOW: ErrorCode = 9003;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const AMOUNT_EXCEEDS_MAX_U64: ErrorCode = 9004;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const SQRT_PRICE_OUT_OF_BOUNDS: ErrorCode = 9005;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_SEQUENCE_EMPTY: ErrorCode = 9006;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const SQRT_PRICE_LIMIT_OUT_OF_BOUNDS: ErrorCode = 9007;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_SQRT_PRICE_LIMIT_DIRECTION: ErrorCode = 9008;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const ZERO_TRADABLE_AMOUNT: ErrorCode = 9009;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_TIMESTAMP: ErrorCode = 9010;
