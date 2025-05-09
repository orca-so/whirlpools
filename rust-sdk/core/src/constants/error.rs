#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

pub type CoreError = &'static str;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_ARRAY_NOT_EVENLY_SPACED: CoreError = "Tick array not evenly spaced";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_INDEX_OUT_OF_BOUNDS: CoreError = "Tick index out of bounds";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_TICK_INDEX: CoreError = "Invalid tick index";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const ARITHMETIC_OVERFLOW: CoreError = "Arithmetic over- or underflow";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const AMOUNT_EXCEEDS_MAX_U64: CoreError = "Amount exceeds max u64";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const SQRT_PRICE_OUT_OF_BOUNDS: CoreError = "Sqrt price out of bounds";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_SEQUENCE_EMPTY: CoreError = "Tick sequence empty";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const SQRT_PRICE_LIMIT_OUT_OF_BOUNDS: CoreError = "Sqrt price limit out of bounds";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_SQRT_PRICE_LIMIT_DIRECTION: CoreError = "Invalid sqrt price limit direction";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const ZERO_TRADABLE_AMOUNT: CoreError = "Zero tradable amount";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_TIMESTAMP: CoreError = "Invalid timestamp";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_TRANSFER_FEE: CoreError = "Invalid transfer fee";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_SLIPPAGE_TOLERANCE: CoreError = "Invalid slippage tolerance";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const TICK_INDEX_NOT_IN_ARRAY: CoreError = "Tick index not in array";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_TICK_ARRAY_SEQUENCE: CoreError = "Invalid tick array sequence";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_ADAPTIVE_FEE_INFO: CoreError = "Invalid adaptive fee info";

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const INVALID_PRICE: CoreError = "Price represented in floating point has to be greater than 0";
