use std::num::TryFromIntError;

use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq)]
pub enum ErrorCode {
    #[msg("Enum value could not be converted")]
    InvalidEnum, // 0x1770 (6000)
    #[msg("Invalid start tick index provided.")]
    InvalidStartTick, // 0x1771 (6001)
    #[msg("Tick-array already exists in this whirlpool")]
    TickArrayExistInPool, // 0x1772 (6002)
    #[msg("Attempt to search for a tick-array failed")]
    TickArrayIndexOutofBounds, // 0x1773 (6003)
    #[msg("Tick-spacing is not supported")]
    InvalidTickSpacing, // 0x1774 (6004)
    #[msg("Position is not empty It cannot be closed")]
    ClosePositionNotEmpty, // 0x1775 (6005)

    #[msg("Unable to divide by zero")]
    DivideByZero, // 0x1776 (6006)
    #[msg("Unable to cast number into BigInt")]
    NumberCastError, //  0x1777 (6007)
    #[msg("Unable to down cast number")]
    NumberDownCastError, //  0x1778 (6008)

    #[msg("Tick not found within tick array")]
    TickNotFound, // 0x1779 (6009)
    #[msg("Provided tick index is either out of bounds or uninitializable")]
    InvalidTickIndex, // 0x177a (6010)
    #[msg("Provided sqrt price out of bounds")]
    SqrtPriceOutOfBounds, // 0x177b (6011)

    #[msg("Liquidity amount must be greater than zero")]
    LiquidityZero, // 0x177c (6012)
    #[msg("Liquidity amount must be less than i64::MAX")]
    LiquidityTooHigh, // 0x177d (6013)
    #[msg("Liquidity overflow")]
    LiquidityOverflow, // 0x177e (6014)
    #[msg("Liquidity underflow")]
    LiquidityUnderflow, // 0x177f (6015)
    #[msg("Tick liquidity net underflowed or overflowed")]
    LiquidityNetError, // 0x1780 (6016)

    #[msg("Exceeded token max")]
    TokenMaxExceeded, // 0x1781 (6017)
    #[msg("Did not meet token min")]
    TokenMinSubceeded, // 0x1782 (6018)

    #[msg("Position token account has a missing or invalid delegate")]
    MissingOrInvalidDelegate, // 0x1783 (6019)
    #[msg("Position token amount must be 1")]
    InvalidPositionTokenAmount, // 0x1784 (6020)

    #[msg("Timestamp should be convertible from i64 to u64")]
    InvalidTimestampConversion, // 0x1785 (6021)
    #[msg("Timestamp should be greater than the last updated timestamp")]
    InvalidTimestamp, // 0x1786 (6022)

    #[msg("Invalid tick array sequence provided for instruction.")]
    InvalidTickArraySequence, // 0x1787 (6023)
    #[msg("Token Mint in wrong order")]
    InvalidTokenMintOrder, // 0x1788 (6024)

    #[msg("Reward not initialized")]
    RewardNotInitialized, // 0x1789 (6025)
    #[msg("Invalid reward index")]
    InvalidRewardIndex, // 0x178a (6026)

    #[msg("Reward vault requires amount to support emissions for at least one day")]
    RewardVaultAmountInsufficient, // 0x178b (6027)
    #[msg("Exceeded max fee rate")]
    FeeRateMaxExceeded, // 0x178c (6028)
    #[msg("Exceeded max protocol fee rate")]
    ProtocolFeeRateMaxExceeded, // 0x178d (6029)

    #[msg("Multiplication with shift right overflow")]
    MultiplicationShiftRightOverflow, // 0x178e (6030)
    #[msg("Muldiv overflow")]
    MulDivOverflow, // 0x178f (6031)
    #[msg("Invalid div_u256 input")]
    MulDivInvalidInput, // 0x1790 (6032)
    #[msg("Multiplication overflow")]
    MultiplicationOverflow, // 0x1791 (6033)

    #[msg("Provided SqrtPriceLimit not in the same direction as the swap.")]
    InvalidSqrtPriceLimitDirection, // 0x1792 (6034)
    #[msg("There are no tradable amount to swap.")]
    ZeroTradableAmount, // 0x1793 (6035)

    #[msg("Amount out below minimum threshold")]
    AmountOutBelowMinimum, // 0x1794 (6036)
    #[msg("Amount in above maximum threshold")]
    AmountInAboveMaximum, // 0x1795 (6037)

    #[msg("Invalid index for tick array sequence")]
    TickArraySequenceInvalidIndex, // 0x1796 (6038)

    #[msg("Amount calculated overflows")]
    AmountCalcOverflow, // 0x1797 (6039)
    #[msg("Amount remaining overflows")]
    AmountRemainingOverflow, // 0x1798 (6040)

    #[msg("Invalid intermediary mint")]
    InvalidIntermediaryMint, // 0x1799 (6041)
    #[msg("Duplicate two hop pool")]
    DuplicateTwoHopPool, // 0x179a (6042)

    #[msg("Bundle index is out of bounds")]
    InvalidBundleIndex, // 0x179b (6043)
    #[msg("Position has already been opened")]
    BundledPositionAlreadyOpened, // 0x179c (6044)
    #[msg("Position has already been closed")]
    BundledPositionAlreadyClosed, // 0x179d (6045)
    #[msg("Unable to delete PositionBundle with open positions")]
    PositionBundleNotDeletable, // 0x179e (6046)

    #[msg("Token mint has unsupported attributes")]
    UnsupportedTokenMint, // 0x179f (6047)

    #[msg("Invalid remaining accounts")]
    RemainingAccountsInvalidSlice, // 0x17a0 (6048)
    #[msg("Insufficient remaining accounts")]
    RemainingAccountsInsufficient, // 0x17a1 (6049)

    #[msg("Unable to call transfer hook without extra accounts")]
    NoExtraAccountsForTransferHook, // 0x17a2 (6050)

    #[msg("Output and input amount mismatch")]
    IntermediateTokenAmountMismatch, // 0x17a3 (6051)

    #[msg("Transfer fee calculation failed")]
    TransferFeeCalculationError, // 0x17a4 (6052)

    #[msg("Same accounts type is provided more than once")]
    RemainingAccountsDuplicatedAccountsType, // 0x17a5 (6053)

    #[msg("This whirlpool only supports full-range positions")]
    FullRangeOnlyPool, // 0x17a6 (6054)

    #[msg("Too many supplemental tick arrays provided")]
    TooManySupplementalTickArrays, // 0x17a7 (6055)
    #[msg("TickArray account for different whirlpool provided")]
    DifferentWhirlpoolTickArrayAccount, // 0x17a8 (6056)

    #[msg("Trade resulted in partial fill")]
    PartialFillError, // 0x17a9 (6057)

    #[msg("Position is not lockable")]
    PositionNotLockable, // 0x17aa (6058)
    #[msg("Operation not allowed on locked position")]
    OperationNotAllowedOnLockedPosition, // 0x17ab (6059)

    #[msg("Cannot reset position range with same tick range")]
    SameTickRangeNotAllowed, // 0x17ac (6060)

    #[msg("Invalid adaptive fee constants")]
    InvalidAdaptiveFeeConstants, // 0x17ad (6061)
    #[msg("Invalid fee tier index")]
    InvalidFeeTierIndex, // 0x17ae (6062)
    #[msg("Invalid trade enable timestamp")]
    InvalidTradeEnableTimestamp, // 0x17af (6063)
    #[msg("Trade is not enabled yet")]
    TradeIsNotEnabled, // 0x17b0 (6064)

    #[msg("Rent calculation error")]
    RentCalculationError, // 0x17b1 (6065)

    #[msg("Feature is not enabled")]
    FeatureIsNotEnabled, // 0x17b2 (6066)

    #[msg("This whirlpool only supports open_position_with_token_extensions instruction")]
    PositionWithTokenExtensionsRequired, // 0x17b3 (6067)
}

impl From<TryFromIntError> for ErrorCode {
    fn from(_: TryFromIntError) -> Self {
        ErrorCode::NumberCastError
    }
}
