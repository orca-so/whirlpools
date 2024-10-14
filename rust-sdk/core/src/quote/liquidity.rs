#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use ethnum::U256;

use crate::{
    order_tick_indexes, position_status, sqrt_price_to_tick_index, tick_index_to_sqrt_price, try_adjust_amount, try_inverse_adjust_amount, AdjustmentType, DecreaseLiquidityQuote, ErrorCode, IncreaseLiquidityQuote, PositionStatus, TransferFee, AMOUNT_EXCEEDS_MAX_U64, ARITHMETIC_OVERFLOW, U128
};

/// Calculate the quote for decreasing liquidity
///
/// # Parameters
/// - `liquidity_delta` - The amount of liquidity to decrease
/// - `slippage_tolerance` - The slippage tolerance in bps
/// - `current_sqrt_price` - The current sqrt price of the pool
/// - `tick_lower_index` - The lower tick index of the position
/// - `tick_upper_index` - The upper tick index of the position
/// - `transfer_fee_a` - The transfer fee for token A in bps
/// - `transfer_fee_b` - The transfer fee for token B in bps
///
/// # Returns
/// - A DecreaseLiquidityQuote struct containing the estimated token amounts
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn decrease_liquidity_quote(
    liquidity_delta: U128,
    slippage_tolerance_bps: u16,
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<DecreaseLiquidityQuote, ErrorCode> {
    let liquidity_delta: u128 = liquidity_delta.into();
    if liquidity_delta == 0 {
        return Ok(DecreaseLiquidityQuote::default());
    }

    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let current_sqrt_price: u128 = current_sqrt_price.into();
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    let (token_est_before_fees_a, token_est_before_fees_b) = try_get_token_estimates_from_liquidity(
        liquidity_delta,
        current_sqrt_price,
        sqrt_price_lower,
        sqrt_price_upper,
    )?;

    let token_min_before_slippage_a = try_adjust_amount(
        token_est_before_fees_a,
        transfer_fee_a.into(),
        false,
    )?;
    let token_min_before_slippage_b = try_adjust_amount(
        token_est_before_fees_b,
        transfer_fee_b.into(),
        false,
    )?;

    let token_est_a =
        try_adjust_amount(token_est_before_fees_a, transfer_fee_a.into(), false)?;
    let token_est_b =
        try_adjust_amount(token_est_before_fees_b, transfer_fee_b.into(), false)?;

    let token_min_a =
        try_adjust_amount(token_min_before_slippage_a, AdjustmentType::Slippage { slippage_tolerance_bps }, false)?;
    let token_min_b =
        try_adjust_amount(token_min_before_slippage_b, AdjustmentType::Slippage { slippage_tolerance_bps }, false)?;

    Ok(DecreaseLiquidityQuote {
        liquidity_delta,
        token_est_a,
        token_est_b,
        token_min_a,
        token_min_b,
    })
}

/// Calculate the quote for decreasing liquidity given a token a amount
///
/// # Parameters
/// - `token_amount_a` - The amount of token a to decrease
/// - `slippage_tolerance` - The slippage tolerance in bps
/// - `current_sqrt_price` - The current sqrt price of the pool
/// - `tick_lower_index` - The lower tick index of the position
/// - `tick_upper_index` - The upper tick index of the position
/// - `transfer_fee_a` - The transfer fee for token A in bps
/// - `transfer_fee_b` - The transfer fee for token B in bps
///
/// # Returns
/// - A DecreaseLiquidityQuote struct containing the estimated token amounts
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn decrease_liquidity_quote_a(
    token_amount_a: u64,
    slippage_tolerance_bps: u16,
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<DecreaseLiquidityQuote, ErrorCode> {
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let token_delta_a =
        try_inverse_adjust_amount(token_amount_a, transfer_fee_a.into(), false)?;

    if token_delta_a == 0 {
        return Ok(DecreaseLiquidityQuote::default());
    }

    let current_sqrt_price: u128 = current_sqrt_price.into();
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    let position_status = position_status(
        current_sqrt_price.into(),
        tick_range.tick_lower_index,
        tick_range.tick_upper_index,
    );

    let liquidity: u128 = match position_status {
        PositionStatus::PriceBelowRange => {
            try_get_liquidity_from_a(token_delta_a, sqrt_price_lower, sqrt_price_upper)?
        }
        PositionStatus::Invalid | PositionStatus::PriceAboveRange => 0,
        PositionStatus::PriceInRange => {
            try_get_liquidity_from_a(token_delta_a, current_sqrt_price, sqrt_price_upper)?
        }
    };

    decrease_liquidity_quote(
        liquidity.into(),
        slippage_tolerance_bps,
        current_sqrt_price.into(),
        tick_lower_index,
        tick_upper_index,
        transfer_fee_a,
        transfer_fee_b,
    )
}

/// Calculate the quote for decreasing liquidity given a token b amount
///
/// # Parameters
/// - `token_amount_b` - The amount of token b to decrease
/// - `slippage_tolerance` - The slippage tolerance in bps
/// - `current_sqrt_price` - The current sqrt price of the pool
/// - `tick_lower_index` - The lower tick index of the position
/// - `tick_upper_index` - The upper tick index of the position
/// - `transfer_fee_a` - The transfer fee for token A in bps
/// - `transfer_fee_b` - The transfer fee for token B in bps
///
/// # Returns
/// - A DecreaseLiquidityQuote struct containing the estimated token amounts
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn decrease_liquidity_quote_b(
    token_amount_b: u64,
    slippage_tolerance_bps: u16,
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<DecreaseLiquidityQuote, ErrorCode> {
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let token_delta_b =
        try_inverse_adjust_amount(token_amount_b, transfer_fee_b.into(), false)?;

    if token_delta_b == 0 {
        return Ok(DecreaseLiquidityQuote::default());
    }

    let current_sqrt_price: u128 = current_sqrt_price.into();
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    let position_status = position_status(
        current_sqrt_price.into(),
        tick_range.tick_lower_index,
        tick_range.tick_upper_index,
    );

    let liquidity: u128 = match position_status {
        PositionStatus::Invalid | PositionStatus::PriceBelowRange => 0,
        PositionStatus::PriceAboveRange => {
            try_get_liquidity_from_b(token_delta_b, sqrt_price_lower, sqrt_price_upper)?
        }
        PositionStatus::PriceInRange => {
            try_get_liquidity_from_b(token_delta_b, sqrt_price_lower, current_sqrt_price)?
        }
    };

    decrease_liquidity_quote(
        liquidity.into(),
        slippage_tolerance_bps,
        current_sqrt_price.into(),
        tick_lower_index,
        tick_upper_index,
        transfer_fee_a,
        transfer_fee_b,
    )
}

/// Calculate the quote for increasing liquidity
///
/// # Parameters
/// - `liquidity_delta` - The amount of liquidity to increase
/// - `slippage_tolerance` - The slippage tolerance in bps
/// - `current_sqrt_price` - The current sqrt price of the pool
/// - `tick_lower_index` - The lower tick index of the position
/// - `tick_upper_index` - The upper tick index of the position
/// - `transfer_fee_a` - The transfer fee for token A in bps
/// - `transfer_fee_b` - The transfer fee for token B in bps
///
/// # Returns
/// - An IncreaseLiquidityQuote struct containing the estimated token amounts
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn increase_liquidity_quote(
    liquidity_delta: U128,
    slippage_tolerance_bps: u16,
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<IncreaseLiquidityQuote, ErrorCode> {
    let liquidity_delta: u128 = liquidity_delta.into();
    if liquidity_delta == 0 {
        return Ok(IncreaseLiquidityQuote::default());
    }

    let current_sqrt_price: u128 = current_sqrt_price.into();
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    let (token_est_before_fees_a, token_est_before_fees_b) = try_get_token_estimates_from_liquidity(
        liquidity_delta,
        current_sqrt_price,
        sqrt_price_lower,
        sqrt_price_upper,
    )?;

    let token_max_before_slippage_a = try_inverse_adjust_amount(
        token_est_before_fees_a,
        transfer_fee_a.into(),
        false,
    )?;
    let token_max_before_slippage_b = try_inverse_adjust_amount(
        token_est_before_fees_b,
        transfer_fee_b.into(),
        false,
    )?;

    let token_est_a =
        try_inverse_adjust_amount(token_est_before_fees_a, transfer_fee_a.into(), false)?;
    let token_est_b =
        try_inverse_adjust_amount(token_est_before_fees_b, transfer_fee_b.into(), false)?;

    let token_max_a =
        try_adjust_amount(token_max_before_slippage_a, AdjustmentType::Slippage { slippage_tolerance_bps }, true)?;
    let token_max_b =
    try_adjust_amount(token_max_before_slippage_b, AdjustmentType::Slippage { slippage_tolerance_bps }, true)?;

    Ok(IncreaseLiquidityQuote {
        liquidity_delta,
        token_est_a,
        token_est_b,
        token_max_a,
        token_max_b,
    })
}

/// Calculate the quote for increasing liquidity given a token a amount
///
/// # Parameters
/// - `token_amount_a` - The amount of token a to increase
/// - `slippage_tolerance` - The slippage tolerance in bps
/// - `current_sqrt_price` - The current sqrt price of the pool
/// - `tick_lower_index` - The lower tick index of the position
/// - `tick_upper_index` - The upper tick index of the position
/// - `transfer_fee_a` - The transfer fee for token A in bps
/// - `transfer_fee_b` - The transfer fee for token B in bps
///
/// # Returns
/// - An IncreaseLiquidityQuote struct containing the estimated token amounts
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn increase_liquidity_quote_a(
    token_amount_a: u64,
    slippage_tolerance_bps: u16,
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<IncreaseLiquidityQuote, ErrorCode> {
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let token_delta_a = try_adjust_amount(token_amount_a, transfer_fee_a.into(), false)?;

    if token_delta_a == 0 {
        return Ok(IncreaseLiquidityQuote::default());
    }

    let current_sqrt_price: u128 = current_sqrt_price.into();
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    let position_status = position_status(
        current_sqrt_price.into(),
        tick_range.tick_lower_index,
        tick_range.tick_upper_index,
    );

    let liquidity: u128 = match position_status {
        PositionStatus::PriceBelowRange => {
            try_get_liquidity_from_a(token_delta_a, sqrt_price_lower, sqrt_price_upper)?
        }
        PositionStatus::Invalid | PositionStatus::PriceAboveRange => 0,
        PositionStatus::PriceInRange => {
            try_get_liquidity_from_a(token_delta_a, current_sqrt_price, sqrt_price_upper)?
        }
    };

    increase_liquidity_quote(
        liquidity.into(),
        slippage_tolerance_bps,
        current_sqrt_price.into(),
        tick_lower_index,
        tick_upper_index,
        transfer_fee_a,
        transfer_fee_b,
    )
}

/// Calculate the quote for increasing liquidity given a token b amount
///
/// # Parameters
/// - `token_amount_b` - The amount of token b to increase
/// - `slippage_tolerance` - The slippage tolerance in bps
/// - `current_sqrt_price` - The current sqrt price of the pool
/// - `tick_lower_index` - The lower tick index of the position
/// - `tick_upper_index` - The upper tick index of the position
/// - `transfer_fee_a` - The transfer fee for token A in bps
/// - `transfer_fee_b` - The transfer fee for token B in bps
///
/// # Returns
/// - An IncreaseLiquidityQuote struct containing the estimated token amounts
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn increase_liquidity_quote_b(
    token_amount_b: u64,
    slippage_tolerance_bps: u16,
    current_sqrt_price: U128,
    tick_lower_index: i32,
    tick_upper_index: i32,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<IncreaseLiquidityQuote, ErrorCode> {
    let tick_range = order_tick_indexes(tick_lower_index, tick_upper_index);
    let token_delta_b = try_adjust_amount(token_amount_b, transfer_fee_b.into(), false)?;

    if token_delta_b == 0 {
        return Ok(IncreaseLiquidityQuote::default());
    }

    let current_sqrt_price: u128 = current_sqrt_price.into();
    let sqrt_price_lower: u128 = tick_index_to_sqrt_price(tick_range.tick_lower_index).into();
    let sqrt_price_upper: u128 = tick_index_to_sqrt_price(tick_range.tick_upper_index).into();

    let position_status = position_status(
        current_sqrt_price.into(),
        tick_range.tick_lower_index,
        tick_range.tick_upper_index,
    );

    let liquidity: u128 = match position_status {
        PositionStatus::Invalid | PositionStatus::PriceBelowRange => 0,
        PositionStatus::PriceAboveRange => {
            try_get_liquidity_from_b(token_delta_b, sqrt_price_lower, sqrt_price_upper)?
        }
        PositionStatus::PriceInRange => {
            try_get_liquidity_from_b(token_delta_b, sqrt_price_lower, current_sqrt_price)?
        }
    };

    increase_liquidity_quote(
        liquidity.into(),
        slippage_tolerance_bps,
        current_sqrt_price.into(),
        tick_lower_index,
        tick_upper_index,
        transfer_fee_a,
        transfer_fee_b,
    )
}

// Private functions

fn try_get_liquidity_from_a(
    token_delta_a: u64,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
) -> Result<u128, ErrorCode> {
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let result: U256 = <U256>::from(token_delta_a)
        .wrapping_mul(sqrt_price_lower.into())
        .wrapping_mul(sqrt_price_upper.into())
        .wrapping_div(sqrt_price_diff.into())
        .wrapping_shr(64);
    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

fn try_get_token_a_from_liquidity(
    liquidity_delta: u128,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let numerator: U256 = <U256>::from(liquidity_delta)
        .saturating_mul(sqrt_price_diff.into())
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let denominator = sqrt_price_upper.saturating_mul(sqrt_price_lower);
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;
    if round_up && remainder != 0 {
        (quotient + 1).try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
    } else {
        quotient.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
    }
}

fn try_get_liquidity_from_b(
    token_delta_b: u64,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
) -> Result<u128, ErrorCode> {
    let numerator: U256 = <U256>::from(token_delta_b).checked_shl(64).ok_or(ARITHMETIC_OVERFLOW)?;
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    numerator
        .saturating_div(sqrt_price_diff.into())
        .try_into()
        .map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

fn try_get_token_b_from_liquidity(
    liquidity_delta: u128,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let p: U256 = <U256>::from(liquidity_delta).saturating_mul(sqrt_price_diff.into());
    let result: U256 = p.wrapping_shr(64);
    if round_up && p & <U256>::from(u64::MAX) > 0 {
        (result + 1).try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
    } else {
        result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
    }
}

fn try_get_token_estimates_from_liquidity(
    liquidity_delta: u128,
    current_sqrt_price: u128,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
) -> Result<(u64, u64), ErrorCode> {
    if liquidity_delta == 0 {
        return Ok((0, 0));
    }

    let tick_lower_index = sqrt_price_to_tick_index(sqrt_price_lower.into());
    let tick_upper_index = sqrt_price_to_tick_index(sqrt_price_upper.into());
    let position_status = position_status(
        current_sqrt_price.into(),
        tick_lower_index,
        tick_upper_index,
    );

    match position_status {
        PositionStatus::PriceBelowRange => {
            let token_a = try_get_token_a_from_liquidity(
                liquidity_delta,
                sqrt_price_lower,
                sqrt_price_upper,
                true,
            )?;
            Ok((token_a, 0))
        }
        PositionStatus::PriceInRange => {
            let token_a = try_get_token_a_from_liquidity(
                liquidity_delta,
                sqrt_price_lower,
                current_sqrt_price,
                false,
            )?;
            let token_b = try_get_token_b_from_liquidity(
                liquidity_delta,
                current_sqrt_price,
                sqrt_price_upper,
                false,
            )?;
            Ok((token_a, token_b))
        }
        PositionStatus::PriceAboveRange => {
            let token_b = try_get_token_b_from_liquidity(
                liquidity_delta,
                sqrt_price_lower,
                sqrt_price_upper,
                true,
            )?;
            Ok((0, token_b))
        }
        PositionStatus::Invalid => Ok((0, 0)),
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    #[test]
    fn test_decrease_liquidity_quote() {
        // Below range
        let result =
            decrease_liquidity_quote(1000000, 100, 18354745142194483561, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 1000);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 990);
        assert_eq!(result.token_min_b, 0);

        // in range
        let result =
            decrease_liquidity_quote(1000000, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_min_a, 495);
        assert_eq!(result.token_min_b, 495);

        // Above range
        let result =
            decrease_liquidity_quote(1000000, 100, 18539204128674405812, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1000);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 990);

        // zero liquidity
        let result = decrease_liquidity_quote(0, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);
    }

    #[test]
    fn test_decrease_liquidity_quote_a() {
        // Below range
        let result =
            decrease_liquidity_quote_a(1000, 100, 18354745142194483561, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000049);
        assert_eq!(result.token_est_a, 1000);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 990);
        assert_eq!(result.token_min_b, 0);

        // in range
        let result =
            decrease_liquidity_quote_a(500, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000300);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_min_a, 495);
        assert_eq!(result.token_min_b, 495);

        // Above range
        let result =
            decrease_liquidity_quote_a(1000, 100, 18539204128674405812, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);

        // zero liquidity
        let result = decrease_liquidity_quote_a(0, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);
    }

    #[test]
    fn test_decrease_liquidity_quote_b() {
        // Below range
        let result =
            decrease_liquidity_quote_b(1000, 100, 18354745142194483561, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);

        // in range
        let result =
            decrease_liquidity_quote_b(500, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000300);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_min_a, 495);
        assert_eq!(result.token_min_b, 495);

        // Above range
        let result =
            decrease_liquidity_quote_b(1000, 100, 18539204128674405812, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000049);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1000);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 990);

        // zero liquidity
        let result = decrease_liquidity_quote_b(0, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);
    }

    #[test]
    fn test_increase_liquidity_quote() {
        // Below range
        let result =
            increase_liquidity_quote(1000000, 100, 18354745142194483561, -10, 10, None, None).unwrap()  ;
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 1000);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 1010);
        assert_eq!(result.token_max_b, 0);

        // in range
        let result =
            increase_liquidity_quote(1000000, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_max_a, 505);
        assert_eq!(result.token_max_b, 505);

        // Above range
        let result =
            increase_liquidity_quote(1000000, 100, 18539204128674405812, -10, 10, None, None).unwrap()  ;
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1000);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 1010);

        // zero liquidity
        let result = increase_liquidity_quote(0, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);
    }

    #[test]
    fn test_increase_liquidity_quote_a() {
        // Below range
        let result =
            increase_liquidity_quote_a(1000, 100, 18354745142194483561, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000049);
        assert_eq!(result.token_est_a, 1000);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 1010);
        assert_eq!(result.token_max_b, 0);

        // in range
        let result =
            increase_liquidity_quote_a(500, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000300);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_max_a, 505);
        assert_eq!(result.token_max_b, 505);

        // Above range
        let result =
            increase_liquidity_quote_a(1000, 100, 18539204128674405812, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);

        // zero liquidity
        let result = increase_liquidity_quote_a(0, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);
    }

    #[test]
    fn test_increase_liquidity_quote_b() {
        // Below range
        let result =
            increase_liquidity_quote_b(1000, 100, 18354745142194483561, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);

        // in range
        let result =
            increase_liquidity_quote_b(500, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000300);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_max_a, 505);
        assert_eq!(result.token_max_b, 505);

        // Above range
        let result =
            increase_liquidity_quote_b(1000, 100, 18539204128674405812, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 1000049);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1000);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 1010);

        // zero liquidity
        let result = increase_liquidity_quote_b(0, 100, 18446744073709551616, -10, 10, None, None).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);
    }

    #[test]
    fn test_decrease_liquidity_quote_with_fee() {
        // Below range
        let result = decrease_liquidity_quote(
            1000000,
            100,
            18354745142194483561,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 800);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 792);
        assert_eq!(result.token_min_b, 0);

        // in range
        let result = decrease_liquidity_quote(
            1000000,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap()  ;
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 400);
        assert_eq!(result.token_est_b, 450);
        assert_eq!(result.token_min_a, 396);
        assert_eq!(result.token_min_b, 445);

        // Above range
        let result = decrease_liquidity_quote(
            1000000,
            100,
            18539204128674405812,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 900);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 891);

        // zero liquidity
        let result = decrease_liquidity_quote(
            0,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);
    }

    #[test]
    fn test_decrease_liquidity_quote_a_with_fee() {
        // Below range
        let result = decrease_liquidity_quote_a(
            1000,
            100,
            18354745142194483561,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1250062);
        assert_eq!(result.token_est_a, 1000);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 990);
        assert_eq!(result.token_min_b, 0);

        // in range
        let result = decrease_liquidity_quote_a(
            500,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1250375);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 562);
        assert_eq!(result.token_min_a, 495);
        assert_eq!(result.token_min_b, 556);

        // Above range
        let result = decrease_liquidity_quote_a(
            1000,
            100,
            18539204128674405812,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);

        // zero liquidity
        let result = decrease_liquidity_quote_a(
            0,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);
    }

    #[test]
    fn test_decrease_liquidity_quote_b_with_fee() {
        // Below range
        let result = decrease_liquidity_quote_b(
            1000,
            100,
            18354745142194483561,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);

        // in range
        let result = decrease_liquidity_quote_b(
            500,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1112333);
        assert_eq!(result.token_est_a, 444);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_min_a, 439);
        assert_eq!(result.token_min_b, 495);

        // Above range
        let result = decrease_liquidity_quote_b(
            1000,
            100,
            18539204128674405812,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1112055);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1000);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 990);

        // zero liquidity
        let result = decrease_liquidity_quote_b(
            0,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_min_a, 0);
        assert_eq!(result.token_min_b, 0);
    }

    #[test]
    fn test_increase_liquidity_quote_with_fee() {
        // Below range
        let result = increase_liquidity_quote(
            1000000,
            100,
            18354745142194483561,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 1250);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 1263);
        assert_eq!(result.token_max_b, 0);

        // in range
        let result = increase_liquidity_quote(
            1000000,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 625);
        assert_eq!(result.token_est_b, 556);
        assert_eq!(result.token_max_a, 632);
        assert_eq!(result.token_max_b, 562);

        // Above range
        let result = increase_liquidity_quote(
            1000000,
            100,
            18539204128674405812,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 1000000);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1112);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 1124);

        // zero liquidity
        let result = increase_liquidity_quote(
            0,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);
    }

    #[test]
    fn test_increase_liquidity_quote_a_with_fee() {
        // Below range
        let result = increase_liquidity_quote_a(
            1000,
            100,
            18354745142194483561,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 800039);
        assert_eq!(result.token_est_a, 1000);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 1010);
        assert_eq!(result.token_max_b, 0);

        // in range
        let result = increase_liquidity_quote_a(
            500,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 800240);
        assert_eq!(result.token_est_a, 500);
        assert_eq!(result.token_est_b, 445);
        assert_eq!(result.token_max_a, 505);
        assert_eq!(result.token_max_b, 450);

        // Above range
        let result = increase_liquidity_quote_a(
            1000,
            100,
            18539204128674405812,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);

        // zero liquidity
        let result = increase_liquidity_quote_a(
            0,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);
    }

    #[test]
    fn test_increase_liquidity_quote_b_with_fee() {
        // Below range
        let result = increase_liquidity_quote_b(
            1000,
            100,
            18354745142194483561,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);

        // in range
        let result = increase_liquidity_quote_b(
            500,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 900270);
        assert_eq!(result.token_est_a, 563);
        assert_eq!(result.token_est_b, 500);
        assert_eq!(result.token_max_a, 569);
        assert_eq!(result.token_max_b, 505);

        // Above range
        let result = increase_liquidity_quote_b(
            1000,
            100,
            18539204128674405812,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 900044);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 1000);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 1010);

        // zero liquidity
        let result = increase_liquidity_quote_b(
            0,
            100,
            18446744073709551616,
            -10,
            10,
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(1000)),
        ).unwrap();
        assert_eq!(result.liquidity_delta, 0);
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, 0);
        assert_eq!(result.token_max_a, 0);
        assert_eq!(result.token_max_b, 0);
    }
}
