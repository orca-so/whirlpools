#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct TransferFee {
    pub fee_bps: u16,
    pub max_fee: u64,
}

impl TransferFee {
    pub fn new(fee_bps: u16) -> Self {
        Self {
            fee_bps,
            max_fee: u64::MAX,
        }
    }

    pub fn new_with_max(fee_bps: u16, max_fee: u64) -> Self {
        Self { fee_bps, max_fee }
    }
}
