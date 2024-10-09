#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::export_ts_const;

/// The maximum number of positions in a position bundle.
#[cfg_attr(feature = "wasm", export_ts_const)]
pub const POSITION_BUNDLE_SIZE: usize = 256;
