use crate::{
    AdjustmentType, ErrorCode, AMOUNT_EXCEEDS_MAX_U64, ARITHMETIC_OVERFLOW, FEE_RATE_DENOMINATOR,
    MAX_SQRT_PRICE, MIN_SQRT_PRICE, SQRT_PRICE_OUT_OF_BOUNDS, U128,
};

use ethnum::U256;
#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

const BPS_DENOMINATOR: u16 = 10000;

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
        .wrapping_mul(sqrt_price_diff.into())
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;

    let denominator: U256 = <U256>::from(sqrt_price_lower).wrapping_mul(sqrt_price_upper.into());

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

    let product: U256 = <U256>::from(current_liquidity).wrapping_mul(sqrt_price_diff.into());
    let quotient: U256 = product.wrapping_shr(64);

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
        .wrapping_mul(current_sqrt_price.into())
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
        current_sqrt_price.wrapping_add(delta)
    } else {
        current_sqrt_price.wrapping_sub(delta)
    };

    if !(MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&result) {
        return Err(SQRT_PRICE_OUT_OF_BOUNDS);
    }

    result
        .try_into()
        .map(|x: u128| x.into())
        .map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

/// Calculate the amount after transfer fee
/// amount_without_transfer_fee > amount_with_transfer_fee
///
/// # Parameters
/// - `amount`: The amount before tranfer fee
/// - `transfer_fee`: The transfer fee
/// - `adjust_up`: Whether to adjust up or down
///
/// # Returns
/// - `u128`: The amount after transfer fee
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_adjust_amount(
    amount: u64,
    adjust_type: AdjustmentType,
    adjust_up: bool,
) -> Result<u64, ErrorCode> {
    if amount == 0 {
        return Ok(0);
    }

    if adjustment_numerator(adjust_type) == 0 {
        return Ok(amount);
    }

    let amount: u128 = amount.into();

    let product = if adjust_up {
        adjustment_denominator(adjust_type) + adjustment_numerator(adjust_type)
    } else {
        adjustment_denominator(adjust_type) - adjustment_numerator(adjust_type)
    };

    let numerator = amount.wrapping_mul(product);
    let denominator = adjustment_denominator(adjust_type);
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

    let max_fee = adjustment_max(adjust_type);
    if fee_amount >= max_fee {
        if adjust_up {
            result = amount + max_fee
        } else {
            result = amount - max_fee
        }
    }

    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

/// Calculate the amount before fee
/// The original transfer amount may not always be unique due to rounding.
/// In this case, the smaller amount will be chosen.
/// e.g. Both transfer amount 10, 11 with 10% fee rate results in net
/// transfer amount of 9. In this case, 10 will be chosen.
///
/// # Parameters
/// - `amount`: The amount after tranfer fee
/// - `transfer_fee`: The transfer fee
/// - `adjust_up`: Whether to adjust up or down
///
/// # Returns
/// - `u128`: The amount before transfer fee
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn try_inverse_adjust_amount(
    amount: u64,
    adjust_type: AdjustmentType,
    adjust_up: bool,
) -> Result<u64, ErrorCode> {
    if amount == 0 {
        return Ok(0);
    }

    if adjustment_numerator(adjust_type) == 0 {
        return Ok(amount);
    }

    let amount: u128 = amount.into();

    let numerator = amount.wrapping_mul(adjustment_denominator(adjust_type));
    let denominator = if adjust_up {
        adjustment_denominator(adjust_type) + adjustment_numerator(adjust_type)
    } else {
        adjustment_denominator(adjust_type) - adjustment_numerator(adjust_type)
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

    let max_fee = adjustment_max(adjust_type);
    if fee_amount >= max_fee {
        if adjust_up {
            result = amount - max_fee
        } else {
            result = amount + max_fee
        }
    }

    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

// Private functions

fn order_prices(a: u128, b: u128) -> (u128, u128) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

fn adjustment_numerator(adjust_type: AdjustmentType) -> u128 {
    match adjust_type {
        AdjustmentType::None => 0,
        AdjustmentType::SwapFee { fee_rate } => fee_rate.into(),
        AdjustmentType::Slippage {
            slippage_tolerance_bps,
        } => slippage_tolerance_bps.into(),
        AdjustmentType::TransferFee {
            fee_bps,
            max_fee: _,
        } => fee_bps.into(),
    }
}

fn adjustment_denominator(adjust_type: AdjustmentType) -> u128 {
    match adjust_type {
        AdjustmentType::SwapFee { fee_rate: _ } => FEE_RATE_DENOMINATOR.into(),
        _ => BPS_DENOMINATOR.into(),
    }
}

fn adjustment_max(adjust_type: AdjustmentType) -> u128 {
    match adjust_type {
        AdjustmentType::TransferFee {
            fee_bps: _,
            max_fee,
        } => max_fee.into(),
        _ => u128::MAX,
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
    fn test_adjust_amount() {
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 10000
                },
                true
            )
            .unwrap(),
            11000
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 10000
                },
                false
            )
            .unwrap(),
            9000
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 500
                },
                true
            )
            .unwrap(),
            10500
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 500
                },
                false
            )
            .unwrap(),
            9500
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 0,
                    max_fee: 10000
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 0,
                    max_fee: 10000
                },
                false
            )
            .unwrap(),
            10000
        );

        assert_eq!(
            try_adjust_amount(10000, AdjustmentType::SwapFee { fee_rate: 1000 }, true).unwrap(),
            10010
        );
        assert_eq!(
            try_adjust_amount(10000, AdjustmentType::SwapFee { fee_rate: 1000 }, false).unwrap(),
            9990
        );
        assert_eq!(
            try_adjust_amount(10000, AdjustmentType::SwapFee { fee_rate: 0 }, true).unwrap(),
            10000
        );
        assert_eq!(
            try_adjust_amount(10000, AdjustmentType::SwapFee { fee_rate: 0 }, false).unwrap(),
            10000
        );

        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 1000
                },
                true
            )
            .unwrap(),
            11000
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 1000
                },
                false
            )
            .unwrap(),
            9000
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 0
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_adjust_amount(
                10000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 0
                },
                false
            )
            .unwrap(),
            10000
        );
    }

    #[test]
    fn test_inverse_adjust_amount() {
        assert_eq!(
            try_inverse_adjust_amount(
                11000,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 10000
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                9000,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 10000
                },
                false
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                10500,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 500
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                9500,
                AdjustmentType::TransferFee {
                    fee_bps: 1000,
                    max_fee: 500
                },
                false
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 0,
                    max_fee: 10000
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                10000,
                AdjustmentType::TransferFee {
                    fee_bps: 0,
                    max_fee: 10000
                },
                false
            )
            .unwrap(),
            10000
        );

        assert_eq!(
            try_inverse_adjust_amount(10010, AdjustmentType::SwapFee { fee_rate: 1000 }, true)
                .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(9990, AdjustmentType::SwapFee { fee_rate: 1000 }, false)
                .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(10000, AdjustmentType::SwapFee { fee_rate: 0 }, true)
                .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(10000, AdjustmentType::SwapFee { fee_rate: 0 }, false)
                .unwrap(),
            10000
        );

        assert_eq!(
            try_inverse_adjust_amount(
                11000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 1000
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                9000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 1000
                },
                false
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                10000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 0
                },
                true
            )
            .unwrap(),
            10000
        );
        assert_eq!(
            try_inverse_adjust_amount(
                10000,
                AdjustmentType::Slippage {
                    slippage_tolerance_bps: 0
                },
                false
            )
            .unwrap(),
            10000
        );
    }
}
