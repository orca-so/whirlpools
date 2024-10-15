#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub enum AdjustmentType {
    None,
    // fee bps, maximum fee
    TransferFee { fee_bps: u16, max_fee: u64 },
    // fee denominated by 1e6
    SwapFee { fee_rate: u16 },
    // slippage bps
    Slippage { slippage_tolerance_bps: u16 },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
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
