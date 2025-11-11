use crate::pinocchio::Result;
use arrayref::array_ref;
use pinocchio::program_error::ProgramError;

use super::super::{ByteBool, BytesU16, BytesU64, Pubkey};

#[repr(C)]
pub struct MemoryMappedTransferFeeConfigExtension {
    transfer_fee_config_authority: Pubkey,
    withdraw_withheld_authority: Pubkey,
    withheld_amount: BytesU64,
    // flatten older_transfer_fee and newer_transfer_fee
    older_transfer_fee_epoch: BytesU64,
    older_transfer_fee_maximum_fee: BytesU64,
    older_transfer_fee_transfer_fee_basis_points: BytesU16,
    newer_transfer_fee_epoch: BytesU64,
    newer_transfer_fee_maximum_fee: BytesU64,
    newer_transfer_fee_transfer_fee_basis_points: BytesU16,
}

impl MemoryMappedTransferFeeConfigExtension {
    #[inline(always)]
    pub fn older_transfer_fee_epoch(&self) -> u64 {
        u64::from_le_bytes(self.older_transfer_fee_epoch)
    }

    #[inline(always)]
    pub fn older_transfer_fee_maximum_fee(&self) -> u64 {
        u64::from_le_bytes(self.older_transfer_fee_maximum_fee)
    }

    #[inline(always)]
    pub fn older_transfer_fee_transfer_fee_basis_points(&self) -> u16 {
        u16::from_le_bytes(self.older_transfer_fee_transfer_fee_basis_points)
    }

    #[inline(always)]
    pub fn newer_transfer_fee_epoch(&self) -> u64 {
        u64::from_le_bytes(self.newer_transfer_fee_epoch)
    }

    #[inline(always)]
    pub fn newer_transfer_fee_maximum_fee(&self) -> u64 {
        u64::from_le_bytes(self.newer_transfer_fee_maximum_fee)
    }

    #[inline(always)]
    pub fn newer_transfer_fee_transfer_fee_basis_points(&self) -> u16 {
        u16::from_le_bytes(self.newer_transfer_fee_transfer_fee_basis_points)
    }
}

#[repr(C)]
pub struct MemoryMappedTransferHookExtension {
    authority: Pubkey,
    program_id: Pubkey,
}

impl MemoryMappedTransferHookExtension {
    #[inline(always)]
    pub fn program_id(&self) -> &Pubkey {
        &self.program_id
    }
}

#[repr(C)]
pub struct MemoryMappedMemoTransfer {
    require_incoming_transfer_memos: ByteBool,
}

impl MemoryMappedMemoTransfer {
    #[inline(always)]
    pub fn is_memo_required(&self) -> bool {
        self.require_incoming_transfer_memos != 0
    }
}

pub struct TokenExtensions<'a> {
    // Extensions for Mint
    pub transfer_fee_config: Option<&'a MemoryMappedTransferFeeConfigExtension>,
    pub transfer_hook: Option<&'a MemoryMappedTransferHookExtension>,
    // Extensions for Account
    pub memo_transfer: Option<&'a MemoryMappedMemoTransfer>,
}

const TLV_TYPE_LENGTH: usize = 2;
const TLV_LENGTH_LENGTH: usize = 2;

const TOKEN_EXTENSION_TYPE_UNINITIALIZED: u16 = 0;
const TOKEN_EXTENSION_TYPE_TRANSFER_FEE_CONFIG: u16 = 1;
const TOKEN_EXTENSION_TYPE_TRANSFER_HOOK: u16 = 14;
const TOKEN_EXTENSION_TYPE_MEMO_TRANSFER: u16 = 8;

pub fn parse_token_extensions<'a>(tlv_data: &'a [u8]) -> Result<TokenExtensions<'a>> {
    let mut transfer_fee_config: Option<&MemoryMappedTransferFeeConfigExtension> = None;
    let mut transfer_hook: Option<&MemoryMappedTransferHookExtension> = None;
    let mut memo_transfer: Option<&MemoryMappedMemoTransfer> = None;
    let mut cursor = 0;

    while cursor < tlv_data.len() {
        let tlv_type_start = cursor;
        let tlv_length_start = tlv_type_start + TLV_TYPE_LENGTH;
        let tlv_value_start = tlv_length_start + TLV_LENGTH_LENGTH;

        if tlv_data.len() < tlv_length_start {
            // There aren't enough bytes to store the next type, which means we
            // got to the end. The last byte could be used during a realloc!
            break;
        }

        let extension_type_num =
            u16::from_le_bytes(*array_ref![tlv_data, tlv_type_start, TLV_TYPE_LENGTH]);

        if extension_type_num == TOKEN_EXTENSION_TYPE_UNINITIALIZED {
            break;
        }

        if tlv_data.len() < tlv_value_start {
            // not enough bytes to store the length, malformed
            return Err(ProgramError::InvalidAccountData.into());
        }
        let length = u16::from_le_bytes(*array_ref![tlv_data, tlv_length_start, TLV_LENGTH_LENGTH]);

        let value_end_index = tlv_value_start.saturating_add(usize::from(length));
        if value_end_index > tlv_data.len() {
            // value blows past the size of the slice, malformed
            return Err(ProgramError::InvalidAccountData.into());
        }

        match extension_type_num {
            TOKEN_EXTENSION_TYPE_TRANSFER_FEE_CONFIG => {
                if length as usize != std::mem::size_of::<MemoryMappedTransferFeeConfigExtension>()
                {
                    return Err(ProgramError::InvalidAccountData.into());
                }
                let ext = unsafe {
                    &*(tlv_data[tlv_value_start..value_end_index].as_ptr()
                        as *const MemoryMappedTransferFeeConfigExtension)
                };
                transfer_fee_config = Some(ext);
            }
            TOKEN_EXTENSION_TYPE_TRANSFER_HOOK => {
                if length as usize != std::mem::size_of::<MemoryMappedTransferHookExtension>() {
                    return Err(ProgramError::InvalidAccountData.into());
                }
                let ext = unsafe {
                    &*(tlv_data[tlv_value_start..value_end_index].as_ptr()
                        as *const MemoryMappedTransferHookExtension)
                };
                transfer_hook = Some(ext);
            }
            TOKEN_EXTENSION_TYPE_MEMO_TRANSFER => {
                if length as usize != std::mem::size_of::<MemoryMappedMemoTransfer>() {
                    return Err(ProgramError::InvalidAccountData.into());
                }
                let ext = unsafe {
                    &*(tlv_data[tlv_value_start..value_end_index].as_ptr()
                        as *const MemoryMappedMemoTransfer)
                };
                memo_transfer = Some(ext);
            }
            _ => {}
        }

        cursor = value_end_index;
    }

    Ok(TokenExtensions {
        transfer_fee_config,
        transfer_hook,
        memo_transfer,
    })
}
