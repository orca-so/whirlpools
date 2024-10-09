// FIXME: disable std for non-test builds to decrease wasm binary size.
// There is currently something in tsify that prevents this:
// https://github.com/madonoharu/tsify/issues/56
// #![cfg_attr(not(test), no_std)]
#![allow(clippy::useless_conversion)]

mod constants;
mod math;
mod quote;
mod types;

pub use constants::*;
pub use math::*;
pub use quote::*;
pub use types::*;
