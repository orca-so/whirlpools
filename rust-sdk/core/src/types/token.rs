#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use tsify::Tsify;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase", tag = "type"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub enum AdjustmentType {
    None,
    // fee bps, maximum fee
    TransferFee {
        fee_bps: u16,
        #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
        max_fee: u64,
    },
    // fee denominated by 1e6
    SwapFee {
        fee_rate: u16,
    },
    // slippage bps
    Slippage {
        slippage_tolerance: u16,
    },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(Serialize, Deserialize, Tsify))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct TransferFee {
    pub fee_bps: u16,
    #[cfg_attr(feature = "wasm", tsify(type = "bigint"))]
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
            Self::TransferFee {
                fee_bps: transfer_fee.fee_bps,
                max_fee: transfer_fee.max_fee,
            }
        } else {
            Self::None
        }
    }
}
