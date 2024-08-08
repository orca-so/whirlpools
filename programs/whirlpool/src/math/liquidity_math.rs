use crate::errors::ErrorCode;

// Adds a signed liquidity delta to a given integer liquidity amount.
// Errors on overflow or underflow.
pub fn add_liquidity_delta(liquidity: u128, delta: i128) -> Result<u128, ErrorCode> {
    if delta == 0 {
        return Ok(liquidity);
    }
    if delta > 0 {
        liquidity
            .checked_add(delta as u128)
            .ok_or(ErrorCode::LiquidityOverflow)
    } else {
        liquidity
            .checked_sub(delta.unsigned_abs())
            .ok_or(ErrorCode::LiquidityUnderflow)
    }
}

// Converts an unsigned liquidity amount to a signed liquidity delta
pub fn convert_to_liquidity_delta(
    liquidity_amount: u128,
    positive: bool,
) -> Result<i128, ErrorCode> {
    if liquidity_amount > i128::MAX as u128 {
        // The liquidity_amount is converted to a liquidity_delta that is represented as an i128
        // By doing this conversion we lose the most significant bit in the u128
        // Here we enforce a max value of i128::MAX on the u128 to prevent loss of data.
        return Err(ErrorCode::LiquidityTooHigh);
    }
    Ok(if positive {
        liquidity_amount as i128
    } else {
        -(liquidity_amount as i128)
    })
}

#[cfg(test)]
mod liquidity_math_tests {
    use super::add_liquidity_delta;
    use super::ErrorCode;

    #[test]
    fn test_valid_add_liquidity_delta() {
        assert_eq!(add_liquidity_delta(100, 100).unwrap(), 200);
        assert_eq!(add_liquidity_delta(100, 0).unwrap(), 100);
        assert_eq!(add_liquidity_delta(100, -100).unwrap(), 0);
    }

    #[test]
    fn test_invalid_add_liquidity_delta_overflow() {
        let result = add_liquidity_delta(u128::MAX, 1);
        assert_eq!(result.unwrap_err(), ErrorCode::LiquidityOverflow);
    }

    #[test]
    fn test_invalid_add_liquidity_delta_underflow() {
        let result = add_liquidity_delta(u128::MIN, -1);
        assert_eq!(result.unwrap_err(), ErrorCode::LiquidityUnderflow);
    }
}
