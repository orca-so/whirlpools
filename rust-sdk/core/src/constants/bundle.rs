#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_const;

/// The maximum number of positions in a position bundle.
#[cfg_attr(feature = "wasm", wasm_const)]
pub const POSITION_BUNDLE_SIZE: usize = 256;
