#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub enum AdjustmentType {
    None,
    // fee bps, maximum fee
    TransferFee(u16, u64),
    // fee denominated by 1e6
    SwapFee(u16),
    // slippage bps
    Slippage(u16),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
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

impl From<Option<TransferFee>> for AdjustmentType {
    fn from(transfer_fee: Option<TransferFee>) -> Self {
        if let Some(transfer_fee) = transfer_fee {
            Self::TransferFee(transfer_fee.fee_bps, transfer_fee.max_fee)
        } else {
            Self::None
        }
    }
}
