#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_const;

/// The number of reward tokens in a pool.
#[cfg_attr(feature = "wasm", wasm_const)]
pub const NUM_REWRARDS: usize = 3;
