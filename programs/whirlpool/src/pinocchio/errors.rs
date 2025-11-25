use anchor_lang::error::Error as AnchorError;
use anchor_lang::prelude::borsh::maybestd::io::Error as BorshIoError;
use pinocchio::program_error::ProgramError as PinocchioProgramError;

pub use crate::errors::ErrorCode as WhirlpoolErrorCode;
pub use anchor_lang::error::ErrorCode as AnchorErrorCode;

#[derive(Debug, PartialEq, Eq)]
pub enum UnifiedError {
    Pinocchio(PinocchioProgramError),
    Anchor(AnchorError),
}

impl From<PinocchioProgramError> for UnifiedError {
    fn from(e: PinocchioProgramError) -> Self {
        UnifiedError::Pinocchio(e)
    }
}

impl From<AnchorErrorCode> for UnifiedError {
    fn from(e: AnchorErrorCode) -> Self {
        UnifiedError::Anchor(e.into())
    }
}

impl From<WhirlpoolErrorCode> for UnifiedError {
    fn from(e: WhirlpoolErrorCode) -> Self {
        UnifiedError::Anchor(e.into())
    }
}

impl From<BorshIoError> for UnifiedError {
    fn from(e: BorshIoError) -> Self {
        UnifiedError::Anchor(AnchorError::from(e))
    }
}

impl From<AnchorError> for UnifiedError {
    fn from(e: AnchorError) -> Self {
        UnifiedError::Anchor(e)
    }
}

impl From<UnifiedError> for u64 {
    fn from(value: UnifiedError) -> Self {
        match value {
            UnifiedError::Pinocchio(e) => e.into(),
            UnifiedError::Anchor(e) => {
                let program_error: anchor_lang::solana_program::program_error::ProgramError =
                    e.into();
                program_error.into()
            }
        }
    }
}
