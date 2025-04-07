use crate::{
    CoreError, TransferFee, AMOUNT_EXCEEDS_MAX_U64, ARITHMETIC_OVERFLOW, BPS_DENOMINATOR,
    FEE_RATE_DENOMINATOR, INVALID_SLIPPAGE_TOLERANCE, INVALID_TRANSFER_FEE, MAX_SQRT_PRICE,
    MIN_SQRT_PRICE, SQRT_PRICE_OUT_OF_BOUNDS, U128,
};

use ethnum::U256;
#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

/// Calculate the amount A delta between two sqrt_prices
///
/// # Parameters
/// - `sqrt_price_1`: The first square root price
/// - `sqrt_price_2`: The second square root price
/// - `liquidity`: The liquidity
/// - `round_up`: Whether to round up or not
///
/// # Returns
/// - `u64`: The amount delta
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_amount_delta_a(
    sqrt_price_1: U128,
    sqrt_price_2: U128,
    liquidity: U128,
    round_up: bool,
) -> Result<u64, CoreError> {
    let (sqrt_price_lower, sqrt_price_upper) =
        order_prices(sqrt_price_1.into(), sqrt_price_2.into());
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let numerator: U256 = <U256>::from(liquidity)
        .checked_mul(sqrt_price_diff.into())
        .ok_or(ARITHMETIC_OVERFLOW)?
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;

    let denominator: U256 = <U256>::from(sqrt_price_lower)
        .checked_mul(sqrt_price_upper.into())
        .ok_or(ARITHMETIC_OVERFLOW)?;

    let quotient = numerator / denominator;
    let remainder = numerator % denominator;

    let result = if round_up && remainder != 0 {
        quotient + 1
    } else {
        quotient
    };

    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

/// Calculate the amount B delta between two sqrt_prices
///
/// # Parameters
/// - `sqrt_price_1`: The first square root price
/// - `sqrt_price_2`: The second square root price
/// - `liquidity`: The liquidity
/// - `round_up`: Whether to round up or not
///
/// # Returns
/// - `u64`: The amount delta
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_amount_delta_b(
    sqrt_price_1: U128,
    sqrt_price_2: U128,
    liquidity: U128,
    round_up: bool,
) -> Result<u64, CoreError> {
    let (sqrt_price_lower, sqrt_price_upper) =
        order_prices(sqrt_price_1.into(), sqrt_price_2.into());
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;

    let product: U256 = <U256>::from(liquidity)
        .checked_mul(sqrt_price_diff.into())
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let quotient: U256 = product >> 64;

    let should_round = round_up && product & <U256>::from(u64::MAX) > 0;

    let result = if should_round { quotient + 1 } else { quotient };

    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

/// Calculate the next square root price
///
/// # Parameters
/// - `current_sqrt_price`: The current square root price
/// - `current_liquidity`: The current liquidity
/// - `amount`: The amount
/// - `specified_input`: Whether the input is specified
///
/// # Returns
/// - `u128`: The next square root price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_next_sqrt_price_from_a(
    current_sqrt_price: U128,
    current_liquidity: U128,
    amount: u64,
    specified_input: bool,
) -> Result<U128, CoreError> {
    if amount == 0 {
        return Ok(current_sqrt_price);
    }
    let current_sqrt_price: u128 = current_sqrt_price.into();
    let current_liquidity: u128 = current_liquidity.into();

    let p = <U256>::from(current_sqrt_price)
        .checked_mul(amount.into())
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let numerator = <U256>::from(current_liquidity)
        .checked_mul(current_sqrt_price.into())
        .ok_or(ARITHMETIC_OVERFLOW)?
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;

    let current_liquidity_shifted = <U256>::from(current_liquidity)
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let denominator = if specified_input {
        current_liquidity_shifted + p
    } else {
        current_liquidity_shifted - p
    };

    let quotient: U256 = numerator / denominator;
    let remainder: U256 = numerator % denominator;

    let result = if remainder != 0 {
        quotient + 1
    } else {
        quotient
    };

    if !(MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&result) {
        return Err(SQRT_PRICE_OUT_OF_BOUNDS);
    }

    Ok(result.as_u128().into())
}

/// Calculate the next square root price
///
/// # Parameters
/// - `current_sqrt_price`: The current square root price
/// - `current_liquidity`: The current liquidity
/// - `amount`: The amount
/// - `specified_input`: Whether the input is specified
///
/// # Returns
/// - `u128`: The next square root price
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_next_sqrt_price_from_b(
    current_sqrt_price: U128,
    current_liquidity: U128,
    amount: u64,
    specified_input: bool,
) -> Result<U128, CoreError> {
    if amount == 0 {
        return Ok(current_sqrt_price);
    }
    let current_sqrt_price = <U256>::from(current_sqrt_price);
    let current_liquidity = <U256>::from(current_liquidity);
    let amount_shifted = <U256>::from(amount)
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;

    let quotient: U256 = amount_shifted / current_liquidity;
    let remainder: U256 = amount_shifted % current_liquidity;

    let delta = if !specified_input && remainder != 0 {
        quotient + 1
    } else {
        quotient
    };

    let result = if specified_input {
        current_sqrt_price + delta
    } else {
        current_sqrt_price - delta
    };

    if !(MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&result) {
        return Err(SQRT_PRICE_OUT_OF_BOUNDS);
    }

    Ok(result.as_u128().into())
}

/// Apply a transfer fee to an amount
/// e.g. You send 10000 amount with 100 fee rate. The fee amount will be 100.
/// So the amount after fee will be 9900.
///
/// # Parameters
/// - `amount`: The amount to apply the fee to
/// - `transfer_fee`: The transfer fee to apply
///
/// # Returns
/// - `u64`: The amount after the fee has been applied
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_apply_transfer_fee(amount: u64, transfer_fee: TransferFee) -> Result<u64, CoreError> {
    if transfer_fee.fee_bps > BPS_DENOMINATOR {
        return Err(INVALID_TRANSFER_FEE);
    }
    if transfer_fee.fee_bps == 0 || amount == 0 {
        return Ok(amount);
    }
    let numerator = <u128>::from(amount)
        .checked_mul(transfer_fee.fee_bps.into())
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let raw_fee: u64 = numerator
        .div_ceil(BPS_DENOMINATOR.into())
        .try_into()
        .map_err(|_| AMOUNT_EXCEEDS_MAX_U64)?;
    let fee_amount = raw_fee.min(transfer_fee.max_fee);
    Ok(amount - fee_amount)
}

/// Reverse the application of a transfer fee to an amount
/// e.g. You received 9900 amount with 100 fee rate. The fee amount will be 100.
/// So the amount before fee will be 10000.
///
/// # Parameters
/// - `amount`: The amount to reverse the fee from
/// - `transfer_fee`: The transfer fee to reverse
///
/// # Returns
/// - `u64`: The amount before the fee has been applied
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_reverse_apply_transfer_fee(
    amount: u64,
    transfer_fee: TransferFee,
) -> Result<u64, CoreError> {
    if transfer_fee.fee_bps > BPS_DENOMINATOR {
        Err(INVALID_TRANSFER_FEE)
    } else if transfer_fee.fee_bps == 0 {
        Ok(amount)
    } else if amount == 0 {
        Ok(0)
    } else if transfer_fee.fee_bps == BPS_DENOMINATOR {
        amount
            .checked_add(transfer_fee.max_fee)
            .ok_or(AMOUNT_EXCEEDS_MAX_U64)
    } else {
        let numerator = <u128>::from(amount)
            .checked_mul(BPS_DENOMINATOR.into())
            .ok_or(ARITHMETIC_OVERFLOW)?;
        let denominator = <u128>::from(BPS_DENOMINATOR) - <u128>::from(transfer_fee.fee_bps);
        let raw_pre_fee_amount = numerator.div_ceil(denominator);
        let fee_amount = raw_pre_fee_amount
            .checked_sub(amount.into())
            .ok_or(AMOUNT_EXCEEDS_MAX_U64)?;
        if fee_amount >= transfer_fee.max_fee as u128 {
            amount
                .checked_add(transfer_fee.max_fee)
                .ok_or(AMOUNT_EXCEEDS_MAX_U64)
        } else {
            raw_pre_fee_amount
                .try_into()
                .map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
        }
    }
}

/// Get the maximum amount with a slippage tolerance
/// e.g. Your estimated amount you send is 10000 with 100 slippage tolerance. The max you send will be 10100.
///
/// # Parameters
/// - `amount`: The amount to apply the fee to
/// - `slippage_tolerance_bps`: The slippage tolerance in bps (should be in range 0..BPS_DENOMINATOR)
///
/// # Returns
/// - `u64`: The maximum amount
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_max_amount_with_slippage_tolerance(
    amount: u64,
    slippage_tolerance_bps: u16,
) -> Result<u64, CoreError> {
    if slippage_tolerance_bps > BPS_DENOMINATOR {
        return Err(INVALID_SLIPPAGE_TOLERANCE);
    }
    let product = <u128>::from(BPS_DENOMINATOR) + <u128>::from(slippage_tolerance_bps);
    let result = try_mul_div(amount, product, BPS_DENOMINATOR.into(), true)?;
    Ok(result)
}

/// Get the minimum amount with a slippage tolerance
/// e.g. Your estimated amount you receive is 10000 with 100 slippage tolerance. The min amount you receive will be 9900.
///
/// # Parameters
/// - `amount`: The amount to apply the fee to
/// - `slippage_tolerance_bps`: The slippage tolerance in bps (should be in range 0..BPS_DENOMINATOR)
///
/// # Returns
/// - `u64`: The minimum amount
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_min_amount_with_slippage_tolerance(
    amount: u64,
    slippage_tolerance_bps: u16,
) -> Result<u64, CoreError> {
    if slippage_tolerance_bps > BPS_DENOMINATOR {
        return Err(INVALID_SLIPPAGE_TOLERANCE);
    }
    let product = <u128>::from(BPS_DENOMINATOR) - <u128>::from(slippage_tolerance_bps);
    let result = try_mul_div(amount, product, BPS_DENOMINATOR.into(), false)?;
    Ok(result)
}

/// Apply a swap fee to an amount
/// e.g. You send 10000 amount with 10000 fee rate. The fee amount will be 100.
/// So the amount after fee will be 9900.
///
/// # Parameters
/// - `amount`: The amount to apply the fee to
/// - `fee_rate`: The fee rate to apply denominated in 1e6
///
/// # Returns
/// - `u64`: The amount after the fee has been applied
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_apply_swap_fee(amount: u64, fee_rate: u16) -> Result<u64, CoreError> {
    let product = <u128>::from(FEE_RATE_DENOMINATOR) - <u128>::from(fee_rate);
    let result = try_mul_div(amount, product, FEE_RATE_DENOMINATOR.into(), false)?;
    Ok(result)
}

/// Reverse the application of a swap fee to an amount
/// e.g. You received 9900 amount with 10000 fee rate. The fee amount will be 100.
/// So the amount before fee will be 10000.
///
/// # Parameters
/// - `amount`: The amount to reverse the fee from
/// - `fee_rate`: The fee rate to reverse denominated in 1e6
///
/// # Returns
/// - `u64`: The amount before the fee has been applied
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_reverse_apply_swap_fee(amount: u64, fee_rate: u16) -> Result<u64, CoreError> {
    let denominator = <u128>::from(FEE_RATE_DENOMINATOR) - <u128>::from(fee_rate);
    let result = try_mul_div(amount, FEE_RATE_DENOMINATOR.into(), denominator, true)?;
    Ok(result)
}

// Private functions

fn try_mul_div(
    amount: u64,
    product: u128,
    denominator: u128,
    round_up: bool,
) -> Result<u64, CoreError> {
    if amount == 0 || product == 0 {
        return Ok(0);
    }

    let amount: u128 = amount.into();
    let numerator = amount.checked_mul(product).ok_or(ARITHMETIC_OVERFLOW)?;
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;

    let result = if round_up && remainder != 0 {
        quotient + 1
    } else {
        quotient
    };

    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

fn order_prices(a: u128, b: u128) -> (u128, u128) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    #[test]
    fn test_get_amount_delta_a() {
        assert_eq!(try_get_amount_delta_a(4 << 64, 2 << 64, 4, true), Ok(1));
        assert_eq!(try_get_amount_delta_a(4 << 64, 2 << 64, 4, false), Ok(1));

        assert_eq!(try_get_amount_delta_a(4 << 64, 4 << 64, 4, true), Ok(0));
        assert_eq!(try_get_amount_delta_a(4 << 64, 4 << 64, 4, false), Ok(0));
    }

    #[test]
    fn test_get_amount_delta_b() {
        assert_eq!(try_get_amount_delta_b(4 << 64, 2 << 64, 4, true), Ok(8));
        assert_eq!(try_get_amount_delta_b(4 << 64, 2 << 64, 4, false), Ok(8));

        assert_eq!(try_get_amount_delta_b(4 << 64, 4 << 64, 4, true), Ok(0));
        assert_eq!(try_get_amount_delta_b(4 << 64, 4 << 64, 4, false), Ok(0));
    }

    #[test]
    fn test_get_next_sqrt_price_from_a() {
        assert_eq!(
            try_get_next_sqrt_price_from_a(4 << 64, 4, 1, true),
            Ok(2 << 64)
        );
        assert_eq!(
            try_get_next_sqrt_price_from_a(2 << 64, 4, 1, false),
            Ok(4 << 64)
        );

        assert_eq!(
            try_get_next_sqrt_price_from_a(4 << 64, 4, 0, true),
            Ok(4 << 64)
        );
        assert_eq!(
            try_get_next_sqrt_price_from_a(4 << 64, 4, 0, false),
            Ok(4 << 64)
        );
    }

    #[test]
    fn test_get_next_sqrt_price_from_b() {
        assert_eq!(
            try_get_next_sqrt_price_from_b(2 << 64, 4, 8, true),
            Ok(4 << 64)
        );
        assert_eq!(
            try_get_next_sqrt_price_from_b(4 << 64, 4, 8, false),
            Ok(2 << 64)
        );

        assert_eq!(
            try_get_next_sqrt_price_from_b(4 << 64, 4, 0, true),
            Ok(4 << 64)
        );
        assert_eq!(
            try_get_next_sqrt_price_from_b(4 << 64, 4, 0, false),
            Ok(4 << 64)
        );
    }

    #[test]
    fn test_apply_transfer_fee() {
        assert_eq!(try_apply_transfer_fee(0, TransferFee::new(100)), Ok(0));
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(0)),
            Ok(10000)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(100)),
            Ok(9900)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(1000)),
            Ok(9000)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(10000)),
            Ok(0)
        );
        assert_eq!(
            try_apply_transfer_fee(u64::MAX, TransferFee::new(1000)),
            Ok(16602069666338596453)
        );
        assert_eq!(
            try_apply_transfer_fee(u64::MAX, TransferFee::new(10000)),
            Ok(0)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(10001)),
            Err(INVALID_TRANSFER_FEE)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(u16::MAX)),
            Err(INVALID_TRANSFER_FEE)
        );
    }

    #[test]
    fn test_apply_transfer_fee_with_max() {
        assert_eq!(
            try_apply_transfer_fee(0, TransferFee::new_with_max(100, 500)),
            Ok(0)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(0, 500)),
            Ok(10000)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(100, 500)),
            Ok(9900)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(1000, 500)),
            Ok(9500)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(10000, 500)),
            Ok(9500)
        );
        assert_eq!(
            try_apply_transfer_fee(u64::MAX, TransferFee::new_with_max(1000, 500)),
            Ok(18446744073709551115)
        );
        assert_eq!(
            try_apply_transfer_fee(u64::MAX, TransferFee::new_with_max(10000, 500)),
            Ok(18446744073709551115)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(10001, 500)),
            Err(INVALID_TRANSFER_FEE)
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(u16::MAX, 500)),
            Err(INVALID_TRANSFER_FEE)
        );
    }

    #[test]
    fn test_reverse_apply_transfer_fee() {
        assert_eq!(
            try_reverse_apply_transfer_fee(0, TransferFee::new(100)),
            Ok(0)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(10000, TransferFee::new(0)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9900, TransferFee::new(100)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9000, TransferFee::new(1000)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(5000, TransferFee::new(10000)),
            Err(AMOUNT_EXCEEDS_MAX_U64)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(0, TransferFee::new(10000)),
            Ok(0)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(u64::MAX, TransferFee::new(10000)),
            Err(AMOUNT_EXCEEDS_MAX_U64)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(10000, TransferFee::new(10001)),
            Err(INVALID_TRANSFER_FEE)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(10000, TransferFee::new(u16::MAX)),
            Err(INVALID_TRANSFER_FEE)
        );
    }

    #[test]
    fn test_reverse_apply_transfer_fee_with_max() {
        assert_eq!(
            try_reverse_apply_transfer_fee(0, TransferFee::new_with_max(100, 500)),
            Ok(0)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(10000, TransferFee::new_with_max(0, 500)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9900, TransferFee::new_with_max(100, 500)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9500, TransferFee::new_with_max(1000, 500)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9500, TransferFee::new_with_max(10000, 500)),
            Ok(10000)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(0, TransferFee::new_with_max(10000, 500)),
            Ok(0)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(u64::MAX - 500, TransferFee::new_with_max(10000, 500)),
            Ok(u64::MAX)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(u64::MAX, TransferFee::new_with_max(10000, 500)),
            Err(AMOUNT_EXCEEDS_MAX_U64)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(10000, TransferFee::new_with_max(10001, 500)),
            Err(INVALID_TRANSFER_FEE)
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(10000, TransferFee::new_with_max(u16::MAX, 500)),
            Err(INVALID_TRANSFER_FEE)
        );
    }

    #[test]
    fn test_get_max_amount_with_slippage_tolerance() {
        assert_eq!(try_get_max_amount_with_slippage_tolerance(0, 100), Ok(0));
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 0),
            Ok(10000)
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 100),
            Ok(10100)
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 1000),
            Ok(11000)
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 10000),
            Ok(20000)
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(u64::MAX, 10000),
            Err(AMOUNT_EXCEEDS_MAX_U64)
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 10001),
            Err(INVALID_SLIPPAGE_TOLERANCE)
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, u16::MAX),
            Err(INVALID_SLIPPAGE_TOLERANCE)
        );
    }

    #[test]
    fn test_get_min_amount_with_slippage_tolerance() {
        assert_eq!(try_get_min_amount_with_slippage_tolerance(0, 100), Ok(0));
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 0),
            Ok(10000)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 100),
            Ok(9900)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 1000),
            Ok(9000)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 10000),
            Ok(0)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(u64::MAX, 10000),
            Ok(0)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(u64::MAX, 1000),
            Ok(16602069666338596453)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 10001),
            Err(INVALID_SLIPPAGE_TOLERANCE)
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, u16::MAX),
            Err(INVALID_SLIPPAGE_TOLERANCE)
        );
    }

    #[test]
    fn test_apply_swap_fee() {
        assert_eq!(try_apply_swap_fee(0, 1000), Ok(0));
        assert_eq!(try_apply_swap_fee(10000, 0), Ok(10000));
        assert_eq!(try_apply_swap_fee(10000, 1000), Ok(9990));
        assert_eq!(try_apply_swap_fee(10000, 10000), Ok(9900));
        assert_eq!(try_apply_swap_fee(10000, u16::MAX), Ok(9344));
        assert_eq!(try_apply_swap_fee(u64::MAX, 1000), Ok(18428297329635842063));
        assert_eq!(
            try_apply_swap_fee(u64::MAX, 10000),
            Ok(18262276632972456098)
        );
    }

    #[test]
    fn test_reverse_apply_swap_fee() {
        assert_eq!(try_reverse_apply_swap_fee(0, 1000), Ok(0));
        assert_eq!(try_reverse_apply_swap_fee(10000, 0), Ok(10000));
        assert_eq!(try_reverse_apply_swap_fee(9990, 1000), Ok(10000));
        assert_eq!(try_reverse_apply_swap_fee(9900, 10000), Ok(10000));
        assert_eq!(try_reverse_apply_swap_fee(9344, u16::MAX), Ok(10000));
        assert_eq!(
            try_reverse_apply_swap_fee(u64::MAX, 1000),
            Err(AMOUNT_EXCEEDS_MAX_U64)
        );
        assert_eq!(
            try_reverse_apply_swap_fee(u64::MAX, 10000),
            Err(AMOUNT_EXCEEDS_MAX_U64)
        );
    }
}
