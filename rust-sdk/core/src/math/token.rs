use crate::{
    ErrorCode, TransferFee, AMOUNT_EXCEEDS_MAX_U64, ARITHMETIC_OVERFLOW, BPS_DENOMINATOR,
    FEE_RATE_DENOMINATOR, MAX_SQRT_PRICE, MIN_SQRT_PRICE, SQRT_PRICE_OUT_OF_BOUNDS, U128,
};

use ethnum::U256;
#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

/// Calculate the amount A delta between two sqrt_prices
///
/// # Parameters
/// - `current_sqrt_price`: The current square root price
/// - `target_sqrt_price`: The target square root price
/// - `current_liquidity`: The current liquidity
/// - `round_up`: Whether to round up or not
///
/// # Returns
/// - `u64`: The amount delta
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_amount_delta_a(
    current_sqrt_price: U128,
    target_sqrt_price: U128,
    current_liquidity: U128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    let (sqrt_price_lower, sqrt_price_upper) =
        order_prices(current_sqrt_price.into(), target_sqrt_price.into());
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let numerator: U256 = <U256>::from(current_liquidity)
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
/// - `current_sqrt_price`: The current square root price
/// - `target_sqrt_price`: The target square root price
/// - `current_liquidity`: The current liquidity
/// - `round_up`: Whether to round up or not
///
/// # Returns
/// - `u64`: The amount delta
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_amount_delta_b(
    current_sqrt_price: U128,
    target_sqrt_price: U128,
    current_liquidity: U128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    let (sqrt_price_lower, sqrt_price_upper) =
        order_prices(current_sqrt_price.into(), target_sqrt_price.into());
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;

    let product: U256 = <U256>::from(current_liquidity)
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
) -> Result<U128, ErrorCode> {
    if amount == 0 {
        return Ok(current_sqrt_price);
    }
    let current_sqrt_price: u128 = current_sqrt_price.into();
    let current_liquidity: u128 = current_liquidity.into();

    let p = <U256>::from(current_sqrt_price).saturating_mul(amount.into());
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

    result
        .try_into()
        .map(|x: u128| x.into())
        .map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
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
) -> Result<U128, ErrorCode> {
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
pub fn try_apply_transfer_fee(amount: u64, transfer_fee: TransferFee) -> Result<u64, ErrorCode> {
    try_adjust_amount(
        amount,
        transfer_fee.fee_bps.into(),
        BPS_DENOMINATOR.into(),
        transfer_fee.max_fee.into(),
        false,
    )
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
) -> Result<u64, ErrorCode> {
    try_reverse_adjust_amount(
        amount,
        transfer_fee.fee_bps.into(),
        BPS_DENOMINATOR.into(),
        transfer_fee.max_fee.into(),
        false,
    )
}

/// Get the maximum amount with a slippage tolerance
/// e.g. Your estimated amount you send is 10000 with 100 slippage tolerance. The max you send will be 10100.
///
/// # Parameters
/// - `amount`: The amount to apply the fee to
/// - `slippage_tolerance_bps`: The slippage tolerance in bps
///
/// # Returns
/// - `u64`: The maximum amount
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_max_amount_with_slippage_tolerance(
    amount: u64,
    slippage_tolerance_bps: u16,
) -> Result<u64, ErrorCode> {
    try_adjust_amount(
        amount,
        slippage_tolerance_bps.into(),
        BPS_DENOMINATOR.into(),
        u128::MAX,
        true,
    )
}

/// Get the minimum amount with a slippage tolerance
/// e.g. Your estimated amount you receive is 10000 with 100 slippage tolerance. The min amount you receive will be 9900.
///
/// # Parameters
/// - `amount`: The amount to apply the fee to
/// - `slippage_tolerance_bps`: The slippage tolerance in bps
///
/// # Returns
/// - `u64`: The minimum amount
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_get_min_amount_with_slippage_tolerance(
    amount: u64,
    slippage_tolerance_bps: u16,
) -> Result<u64, ErrorCode> {
    try_adjust_amount(
        amount,
        slippage_tolerance_bps.into(),
        BPS_DENOMINATOR.into(),
        u128::MAX,
        false,
    )
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
pub fn try_apply_swap_fee(amount: u64, fee_rate: u16) -> Result<u64, ErrorCode> {
    try_adjust_amount(
        amount,
        fee_rate.into(),
        FEE_RATE_DENOMINATOR.into(),
        u128::MAX,
        false,
    )
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
pub fn try_reverse_apply_swap_fee(amount: u64, fee_rate: u16) -> Result<u64, ErrorCode> {
    try_reverse_adjust_amount(
        amount,
        fee_rate.into(),
        FEE_RATE_DENOMINATOR.into(),
        u128::MAX,
        false,
    )
}

// Private functions

fn try_adjust_amount(
    amount: u64,
    adjust_numerator: u128,
    adjust_denominator: u128,
    adjust_max: u128,
    adjust_up: bool,
) -> Result<u64, ErrorCode> {
    if amount == 0 {
        return Ok(0);
    }

    if adjust_numerator == 0 {
        return Ok(amount);
    }

    let amount: u128 = amount.into();

    let product = if adjust_up {
        adjust_denominator + adjust_numerator
    } else {
        adjust_denominator - adjust_numerator
    };

    let numerator = amount.checked_mul(product).ok_or(ARITHMETIC_OVERFLOW)?;
    let denominator = adjust_denominator;
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;

    let mut result: u128 = if adjust_up && remainder != 0 {
        quotient + 1
    } else {
        quotient
    };

    let fee_amount = if adjust_up {
        result - amount
    } else {
        amount - result
    };

    if fee_amount >= adjust_max {
        if adjust_up {
            result = amount + adjust_max
        } else {
            result = amount - adjust_max
        }
    }

    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

fn try_reverse_adjust_amount(
    amount: u64,
    adjust_numerator: u128,
    adjust_denominator: u128,
    adjust_max: u128,
    adjust_up: bool,
) -> Result<u64, ErrorCode> {
    if amount == 0 {
        return Ok(0);
    }

    if adjust_numerator == 0 {
        return Ok(amount);
    }

    let amount: u128 = amount.into();

    let numerator = amount
        .checked_mul(adjust_denominator)
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let denominator = if adjust_up {
        adjust_denominator + adjust_numerator
    } else {
        adjust_denominator - adjust_numerator
    };

    let quotient = numerator / denominator;
    let remainder = numerator % denominator;

    let mut result = if !adjust_up && remainder != 0 {
        quotient + 1
    } else {
        quotient
    };

    let fee_amount = if adjust_up {
        amount - result
    } else {
        result - amount
    };

    if fee_amount >= adjust_max {
        if adjust_up {
            result = amount - adjust_max
        } else {
            result = amount + adjust_max
        }
    }

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
        assert_eq!(
            try_get_amount_delta_a(4 << 64, 2 << 64, 4, true).unwrap(),
            1
        );
        assert_eq!(
            try_get_amount_delta_a(4 << 64, 2 << 64, 4, false).unwrap(),
            1
        );

        assert_eq!(
            try_get_amount_delta_a(4 << 64, 4 << 64, 4, true).unwrap(),
            0
        );
        assert_eq!(
            try_get_amount_delta_a(4 << 64, 4 << 64, 4, false).unwrap(),
            0
        );
    }

    #[test]
    fn test_get_amount_delta_b() {
        assert_eq!(
            try_get_amount_delta_b(4 << 64, 2 << 64, 4, true).unwrap(),
            8
        );
        assert_eq!(
            try_get_amount_delta_b(4 << 64, 2 << 64, 4, false).unwrap(),
            8
        );

        assert_eq!(
            try_get_amount_delta_b(4 << 64, 4 << 64, 4, true).unwrap(),
            0
        );
        assert_eq!(
            try_get_amount_delta_b(4 << 64, 4 << 64, 4, false).unwrap(),
            0
        );
    }

    #[test]
    fn test_get_next_sqrt_price_from_a() {
        assert_eq!(
            try_get_next_sqrt_price_from_a(4 << 64, 4, 1, true).unwrap(),
            2 << 64
        );
        assert_eq!(
            try_get_next_sqrt_price_from_a(2 << 64, 4, 1, false).unwrap(),
            4 << 64
        );

        assert_eq!(
            try_get_next_sqrt_price_from_a(4 << 64, 4, 0, true).unwrap(),
            4 << 64
        );
        assert_eq!(
            try_get_next_sqrt_price_from_a(4 << 64, 4, 0, false).unwrap(),
            4 << 64
        );
    }

    #[test]
    fn test_get_next_sqrt_price_from_b() {
        assert_eq!(
            try_get_next_sqrt_price_from_b(2 << 64, 4, 8, true).unwrap(),
            4 << 64
        );
        assert_eq!(
            try_get_next_sqrt_price_from_b(4 << 64, 4, 8, false).unwrap(),
            2 << 64
        );

        assert_eq!(
            try_get_next_sqrt_price_from_b(4 << 64, 4, 0, true).unwrap(),
            4 << 64
        );
        assert_eq!(
            try_get_next_sqrt_price_from_b(4 << 64, 4, 0, false).unwrap(),
            4 << 64
        );
    }

    #[test]
    fn test_apply_transfer_fee() {
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(100)).unwrap(),
            9900
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new(1000)).unwrap(),
            9000
        );
    }

    #[test]
    fn test_apply_transfer_fee_with_max() {
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(100, 500)).unwrap(),
            9900
        );
        assert_eq!(
            try_apply_transfer_fee(10000, TransferFee::new_with_max(1000, 500)).unwrap(),
            9500
        );
    }

    #[test]
    fn test_reverse_apply_transfer_fee() {
        assert_eq!(
            try_reverse_apply_transfer_fee(9900, TransferFee::new(100)).unwrap(),
            10000
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9000, TransferFee::new(1000)).unwrap(),
            10000
        );
    }

    #[test]
    fn test_reverse_apply_transfer_fee_with_max() {
        assert_eq!(
            try_reverse_apply_transfer_fee(9900, TransferFee::new_with_max(100, 500)).unwrap(),
            10000
        );
        assert_eq!(
            try_reverse_apply_transfer_fee(9500, TransferFee::new_with_max(1000, 500)).unwrap(),
            10000
        );
    }

    #[test]
    fn test_get_max_amount_with_slippage_tolerance() {
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 100).unwrap(),
            10100
        );
        assert_eq!(
            try_get_max_amount_with_slippage_tolerance(10000, 1000).unwrap(),
            11000
        );
    }

    #[test]
    fn test_get_min_amount_with_slippage_tolerance() {
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 100).unwrap(),
            9900
        );
        assert_eq!(
            try_get_min_amount_with_slippage_tolerance(10000, 1000).unwrap(),
            9000
        );
    }

    #[test]
    fn test_apply_swap_fee() {
        assert_eq!(try_apply_swap_fee(10000, 1000).unwrap(), 9990);
        assert_eq!(try_apply_swap_fee(10000, 10000).unwrap(), 9900);
    }

    #[test]
    fn test_reverse_apply_swap_fee() {
        assert_eq!(try_reverse_apply_swap_fee(9990, 1000).unwrap(), 10000);
        assert_eq!(try_reverse_apply_swap_fee(9900, 10000).unwrap(), 10000);
    }
}
