use crate::errors::ErrorCode;
use crate::math::Q64_RESOLUTION;

use super::{
    checked_mul_shift_right_round_up_if, div_round_up_if, div_round_up_if_u256, mul_u256,
    U256Muldiv, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64,
};

// Fee rate is represented as hundredths of a basis point.
// Fee amount = total_amount * fee_rate / 1_000_000.
// Max fee rate supported is 1%.
pub const MAX_FEE_RATE: u16 = 10_000;

// Assuming that FEE_RATE is represented as hundredths of a basis point
// We want FEE_RATE_MUL_VALUE = 1/FEE_RATE_UNIT, so 1e6
pub const FEE_RATE_MUL_VALUE: u128 = 1_000_000;

// Protocol fee rate is represented as a basis point.
// Protocol fee amount = fee_amount * protocol_fee_rate / 10_000.
// Max protocol fee rate supported is 25% of the fee rate.
pub const MAX_PROTOCOL_FEE_RATE: u16 = 2_500;

// Assuming that PROTOCOL_FEE_RATE is represented as a basis point
// We want PROTOCOL_FEE_RATE_MUL_VALUE = 1/PROTOCOL_FEE_UNIT, so 1e4
pub const PROTOCOL_FEE_RATE_MUL_VALUE: u128 = 10_000;

//
// Get change in token_a corresponding to a change in price
//

// 6.16
// Δt_a = Δ(1 / sqrt_price) * liquidity

// Replace delta
// Δt_a = (1 / sqrt_price_upper - 1 / sqrt_price_lower) * liquidity

// Common denominator to simplify
// Δt_a = ((sqrt_price_lower - sqrt_price_upper) / (sqrt_price_upper * sqrt_price_lower)) * liquidity

// Δt_a = (liquidity * (sqrt_price_lower - sqrt_price_upper)) / (sqrt_price_upper * sqrt_price_lower)
pub fn get_amount_delta_a(
    sqrt_price_0: u128,
    sqrt_price_1: u128,
    liquidity: u128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    let (sqrt_price_lower, sqrt_price_upper) = increasing_price_order(sqrt_price_0, sqrt_price_1);

    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;

    let numerator = mul_u256(liquidity, sqrt_price_diff)
        .checked_shift_word_left()
        .ok_or(ErrorCode::MultiplicationOverflow)?;

    let denominator = mul_u256(sqrt_price_upper, sqrt_price_lower);

    let (quotient, remainder) = numerator.div(denominator, round_up);

    let result = if round_up && !remainder.is_zero() {
        quotient.add(U256Muldiv::new(0, 1)).try_into_u128()?
    } else {
        quotient.try_into_u128()?
    };

    if result > u64::MAX as u128 {
        return Err(ErrorCode::TokenMaxExceeded);
    }

    return Ok(result as u64);
}

//
// Get change in token_b corresponding to a change in price
//

// 6.14
// Δt_b = Δ(sqrt_price) * liquidity

// Replace delta
// Δt_b = (sqrt_price_upper - sqrt_price_lower) * liquidity
pub fn get_amount_delta_b(
    sqrt_price_0: u128,
    sqrt_price_1: u128,
    liquidity: u128,
    round_up: bool,
) -> Result<u64, ErrorCode> {
    let (price_lower, price_upper) = increasing_price_order(sqrt_price_0, sqrt_price_1);

    // liquidity * (price_upper - price_lower) must be less than 2^128
    // for the token amount to be less than 2^64
    checked_mul_shift_right_round_up_if(liquidity, price_upper - price_lower, round_up)
}

pub fn increasing_price_order(sqrt_price_0: u128, sqrt_price_1: u128) -> (u128, u128) {
    if sqrt_price_0 > sqrt_price_1 {
        (sqrt_price_1, sqrt_price_0)
    } else {
        (sqrt_price_0, sqrt_price_1)
    }
}

//
// Get change in price corresponding to a change in token_a supply
//
// 6.15
// Δ(1 / sqrt_price) = Δt_a / liquidity
//
// Replace delta
// 1 / sqrt_price_new - 1 / sqrt_price = amount / liquidity
//
// Move sqrt price to other side
// 1 / sqrt_price_new = (amount / liquidity) + (1 / sqrt_price)
//
// Common denominator for right side
// 1 / sqrt_price_new = (sqrt_price * amount + liquidity) / (sqrt_price * liquidity)
//
// Invert fractions
// sqrt_price_new = (sqrt_price * liquidity) / (liquidity + amount * sqrt_price)
pub fn get_next_sqrt_price_from_a_round_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
    amount_specified_is_input: bool,
) -> Result<u128, ErrorCode> {
    if amount == 0 {
        return Ok(sqrt_price);
    }
    let product = mul_u256(sqrt_price, amount as u128);

    let numerator = mul_u256(liquidity, sqrt_price)
        .checked_shift_word_left()
        .ok_or(ErrorCode::MultiplicationOverflow)?;

    // In this scenario the denominator will end up being < 0
    let liquidity_shift_left = U256Muldiv::new(0, liquidity).shift_word_left();
    if !amount_specified_is_input && liquidity_shift_left.lte(product) {
        return Err(ErrorCode::DivideByZero);
    }

    let denominator = if amount_specified_is_input {
        liquidity_shift_left.add(product)
    } else {
        liquidity_shift_left.sub(product)
    };

    let price = div_round_up_if_u256(numerator, denominator, true)?;
    if price < MIN_SQRT_PRICE_X64 {
        return Err(ErrorCode::TokenMinSubceeded);
    } else if price > MAX_SQRT_PRICE_X64 {
        return Err(ErrorCode::TokenMaxExceeded);
    }

    Ok(price)
}

//
// Get change in price corresponding to a change in token_b supply
//
// 6.13
// Δ(sqrt_price) = Δt_b / liquidity
pub fn get_next_sqrt_price_from_b_round_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
    amount_specified_is_input: bool,
) -> Result<u128, ErrorCode> {
    // We always want square root price to be rounded down, which means
    // Case 3. If we are fixing input (adding B), we are increasing price, we want delta to be floor(delta)
    // sqrt_price + floor(delta) < sqrt_price + delta
    //
    // Case 4. If we are fixing output (removing B), we are decreasing price, we want delta to be ceil(delta)
    // sqrt_price - ceil(delta) < sqrt_price - delta

    // Q64.0 << 64 => Q64.64
    let amount_x64 = (amount as u128) << Q64_RESOLUTION;

    // Q64.64 / Q64.0 => Q64.64
    let delta = div_round_up_if(amount_x64, liquidity, !amount_specified_is_input)?;

    // Q64(32).64 +/- Q64.64
    if amount_specified_is_input {
        // We are adding token b to supply, causing price to increase
        sqrt_price
            .checked_add(delta)
            .ok_or(ErrorCode::SqrtPriceOutOfBounds)
    } else {
        // We are removing token b from supply,. causing price to decrease
        sqrt_price
            .checked_sub(delta)
            .ok_or(ErrorCode::SqrtPriceOutOfBounds)
    }
}

pub fn get_next_sqrt_price(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<u128, ErrorCode> {
    if amount_specified_is_input == a_to_b {
        // We are fixing A
        // Case 1. amount_specified_is_input = true, a_to_b = true
        // We are exchanging A to B with at most _amount_ of A (input)
        //
        // Case 2. amount_specified_is_input = false, a_to_b = false
        // We are exchanging B to A wanting to guarantee at least _amount_ of A (output)
        //
        // In either case we want the sqrt_price to be rounded up.
        //
        // Eq 1. sqrt_price = sqrt( b / a )
        //
        // Case 1. amount_specified_is_input = true, a_to_b = true
        // We are adding token A to the supply, causing price to decrease (Eq 1.)
        // Since we are fixing input, we can not exceed the amount that is being provided by the user.
        // Because a higher price is inversely correlated with an increased supply of A,
        // a higher price means we are adding less A. Thus when performing math, we wish to round the
        // price up, since that means that we are guaranteed to not exceed the fixed amount of A provided.
        //
        // Case 2. amount_specified_is_input = false, a_to_b = false
        // We are removing token A from the supply, causing price to increase (Eq 1.)
        // Since we are fixing output, we want to guarantee that the user is provided at least _amount_ of A
        // Because a higher price is correlated with a decreased supply of A,
        // a higher price means we are removing more A to give to the user. Thus when performing math, we wish
        // to round the price up, since that means we guarantee that user receives at least _amount_ of A
        get_next_sqrt_price_from_a_round_up(
            sqrt_price,
            liquidity,
            amount,
            amount_specified_is_input,
        )
    } else {
        // We are fixing B
        // Case 3. amount_specified_is_input = true, a_to_b = false
        // We are exchanging B to A using at most _amount_ of B (input)
        //
        // Case 4. amount_specified_is_input = false, a_to_b = true
        // We are exchanging A to B wanting to guarantee at least _amount_ of B (output)
        //
        // In either case we want the sqrt_price to be rounded down.
        //
        // Eq 1. sqrt_price = sqrt( b / a )
        //
        // Case 3. amount_specified_is_input = true, a_to_b = false
        // We are adding token B to the supply, causing price to increase (Eq 1.)
        // Since we are fixing input, we can not exceed the amount that is being provided by the user.
        // Because a lower price is inversely correlated with an increased supply of B,
        // a lower price means that we are adding less B. Thus when performing math, we wish to round the
        // price down, since that means that we are guaranteed to not exceed the fixed amount of B provided.
        //
        // Case 4. amount_specified_is_input = false, a_to_b = true
        // We are removing token B from the supply, causing price to decrease (Eq 1.)
        // Since we are fixing output, we want to guarantee that the user is provided at least _amount_ of B
        // Because a lower price is correlated with a decreased supply of B,
        // a lower price means we are removing more B to give to the user. Thus when performing math, we
        // wish to round the price down, since that means we guarantee that the user receives at least _amount_ of B
        get_next_sqrt_price_from_b_round_down(
            sqrt_price,
            liquidity,
            amount,
            amount_specified_is_input,
        )
    }
}

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use crate::math::{bit_math::*, tick_math::*, U256};
    use proptest::prelude::*;

    // Cases where the math overflows or errors
    //
    // get_next_sqrt_price_from_a_round_up
    // sqrt_price_new = (sqrt_price * liquidity) / (liquidity + amount * sqrt_price)
    //
    // If amount_specified_is_input == false
    //      DivideByZero: (liquidity / liquidity - amount * sqrt_price)
    //           liquidity <= sqrt_price * amount, divide by zero error
    //      TokenMax/MinExceed
    //           (sqrt_price * liquidity) / (liquidity + amount * sqrt_price) > 2^32 - 1
    //
    // get_next_sqrt_price_from_b_round_down
    //      SqrtPriceOutOfBounds
    //          sqrt_price - (amount / liquidity) < 0
    //
    // get_amount_delta_b
    //      TokenMaxExceeded
    //          (price_1 - price_0) * liquidity > 2^64

    proptest! {
        #[test]
        fn test_get_next_sqrt_price_from_a_round_up (
            sqrt_price in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            liquidity in 1..u128::MAX,
            amount in 0..u64::MAX,
        ) {
            prop_assume!(sqrt_price != 0);

            // Case 1. amount_specified_is_input = true, a_to_b = true
            // We are adding token A to the supply, causing price to decrease (Eq 1.)
            // Since we are fixing input, we can not exceed the amount that is being provided by the user.
            // Because a higher price is inversely correlated with an increased supply of A,
            // a higher price means we are adding less A. Thus when performing math, we wish to round the
            // price up, since that means that we are guaranteed to not exceed the fixed amount of A provided
            let case_1_price = get_next_sqrt_price_from_a_round_up(sqrt_price, liquidity, amount, true);
            if liquidity.leading_zeros() + sqrt_price.leading_zeros() < Q64_RESOLUTION.into() {
                assert!(case_1_price.is_err());
            } else {
                assert!(amount >= get_amount_delta_a(sqrt_price, case_1_price.unwrap(), liquidity, true).unwrap());

                // Case 2. amount_specified_is_input = false, a_to_b = false
                // We are removing token A from the supply, causing price to increase (Eq 1.)
                // Since we are fixing output, we want to guarantee that the user is provided at least _amount_ of A
                // Because a higher price is correlated with a decreased supply of A,
                // a higher price means we are removing more A to give to the user. Thus when performing math, we wish
                // to round the price up, since that means we guarantee that user receives at least _amount_ of A
                let case_2_price = get_next_sqrt_price_from_a_round_up(sqrt_price, liquidity, amount, false);


                // We need to expand into U256 space here in order to support large enough values
                // Q64 << 64 => Q64.64
                let liquidity_x64 = U256::from(liquidity) << Q64_RESOLUTION;

                // Q64.64 * Q64 => Q128.64
                let product = U256::from(sqrt_price) * U256::from(amount);
                if liquidity_x64 <= product {
                    assert!(case_2_price.is_err());
                } else {
                    assert!(amount <= get_amount_delta_a(sqrt_price, case_2_price.unwrap(), liquidity, false).unwrap());
                    assert!(case_2_price.unwrap() >= sqrt_price);
                }

                if amount == 0 {
                    assert!(case_1_price.unwrap() == case_2_price.unwrap());
                }
            }
        }

        #[test]
        fn test_get_next_sqrt_price_from_b_round_down (
            sqrt_price in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            liquidity in 1..u128::MAX,
            amount in 0..u64::MAX,
        ) {
            prop_assume!(sqrt_price != 0);

            // Case 3. amount_specified_is_input = true, a_to_b = false
            // We are adding token B to the supply, causing price to increase (Eq 1.)
            // Since we are fixing input, we can not exceed the amount that is being provided by the user.
            // Because a lower price is inversely correlated with an increased supply of B,
            // a lower price means that we are adding less B. Thus when performing math, we wish to round the
            // price down, since that means that we are guaranteed to not exceed the fixed amount of B provided.
            let case_3_price = get_next_sqrt_price_from_b_round_down(sqrt_price, liquidity, amount, true).unwrap();
            assert!(case_3_price >= sqrt_price);
            assert!(amount >= get_amount_delta_b(sqrt_price, case_3_price, liquidity, true).unwrap());

            // Case 4. amount_specified_is_input = false, a_to_b = true
            // We are removing token B from the supply, causing price to decrease (Eq 1.)
            // Since we are fixing output, we want to guarantee that the user is provided at least _amount_ of B
            // Because a lower price is correlated with a decreased supply of B,
            // a lower price means we are removing more B to give to the user. Thus when performing math, we
            // wish to round the price down, since that means we guarantee that the user receives at least _amount_ of B
            let case_4_price = get_next_sqrt_price_from_b_round_down(sqrt_price, liquidity, amount, false);

            // Q64.0 << 64 => Q64.64
            let amount_x64 = u128::from(amount) << Q64_RESOLUTION;
            let delta = div_round_up(amount_x64, liquidity.into()).unwrap();

            if sqrt_price < delta {
                // In Case 4, error if sqrt_price < delta
                assert!(case_4_price.is_err());
            } else {
                let calc_delta = get_amount_delta_b(sqrt_price, case_4_price.unwrap(), liquidity, false);
                if calc_delta.is_ok() {
                    assert!(amount <= calc_delta.unwrap());
                }
                // In Case 4, price is decreasing
                assert!(case_4_price.unwrap() <= sqrt_price);
            }

            if amount == 0 {
                assert!(case_3_price == case_4_price.unwrap());
            }
        }


        #[test]
        fn test_get_amount_delta_a(
            sqrt_price_0 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            sqrt_price_1 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            liquidity in 0..u128::MAX,
        ) {
            let (sqrt_price_lower, sqrt_price_upper) = increasing_price_order(sqrt_price_0, sqrt_price_1);

            let rounded = get_amount_delta_a(sqrt_price_0, sqrt_price_1, liquidity, true);

            if liquidity.leading_zeros() + (sqrt_price_upper - sqrt_price_lower).leading_zeros() < Q64_RESOLUTION.into() {
                assert!(rounded.is_err())
            } else {
                let unrounded = get_amount_delta_a(sqrt_price_0, sqrt_price_1, liquidity, false).unwrap();

                // Price difference symmetry
                assert_eq!(rounded.unwrap(), get_amount_delta_a(sqrt_price_1, sqrt_price_0, liquidity, true).unwrap());
                assert_eq!(unrounded, get_amount_delta_a(sqrt_price_1, sqrt_price_0, liquidity, false).unwrap());

                // Rounded should always be larger
                assert!(unrounded <= rounded.unwrap());

                // Diff should be no more than 1
                assert!(rounded.unwrap() - unrounded <= 1);
            }
        }

        #[test]
        fn test_get_amount_delta_b(
            sqrt_price_0 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            sqrt_price_1 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            liquidity in 0..u128::MAX,
        ) {
            let (price_lower, price_upper) = increasing_price_order(sqrt_price_0, sqrt_price_1);

            // We need 256 here since we may end up above u128 bits
            let n_0 = U256::from(liquidity); // Q64.0, not using 64 MSB
            let n_1 = U256::from(price_upper - price_lower); // Q32.64 - Q32.64 => Q32.64

            // Shift by 64 in order to remove fractional bits
            let m = n_0 * n_1; // Q64.0 * Q32.64 => Q96.64
            let delta = m >> Q64_RESOLUTION; // Q96.64 >> 64 => Q96.0
            let has_mod = m % TO_Q64 > U256::zero();
            let round_up_delta = if has_mod { delta + U256::from(1) } else { delta };

            let rounded = get_amount_delta_b(sqrt_price_0, sqrt_price_1, liquidity, true);
            let unrounded = get_amount_delta_b(sqrt_price_0, sqrt_price_1, liquidity, false);

            let u64_max_in_u256 = U256::from(u64::MAX);
            if delta > u64_max_in_u256 {
                assert!(rounded.is_err());
                assert!(unrounded.is_err());
            } else if round_up_delta > u64_max_in_u256 {
                assert!(rounded.is_err());
                // Price symmmetry
                assert_eq!(unrounded.unwrap(), get_amount_delta_b(sqrt_price_1, sqrt_price_0, liquidity, false).unwrap());
            } else {
                // Price difference symmetry
                assert_eq!(rounded.unwrap(), get_amount_delta_b(sqrt_price_1, sqrt_price_0, liquidity, true).unwrap());
                assert_eq!(unrounded.unwrap(), get_amount_delta_b(sqrt_price_1, sqrt_price_0, liquidity, false).unwrap());

                // Rounded should always be larger
                assert!(unrounded.unwrap() <= rounded.unwrap());

                // Diff should be no more than 1
                assert!(rounded.unwrap() - unrounded.unwrap() <= 1);
            }

        }
    }
}

#[cfg(test)]
mod test_get_amount_delta {
    // Δt_a = ((liquidity * (sqrt_price_lower - sqrt_price_upper)) / sqrt_price_upper) / sqrt_price_lower
    use super::get_amount_delta_a;
    use super::get_amount_delta_b;

    #[test]
    fn test_get_amount_delta_ok() {
        // A
        assert_eq!(get_amount_delta_a(4 << 64, 2 << 64, 4, true).unwrap(), 1);
        assert_eq!(get_amount_delta_a(4 << 64, 2 << 64, 4, false).unwrap(), 1);

        // B
        assert_eq!(get_amount_delta_b(4 << 64, 2 << 64, 4, true).unwrap(), 8);
        assert_eq!(get_amount_delta_b(4 << 64, 2 << 64, 4, false).unwrap(), 8);
    }

    #[test]
    fn test_get_amount_delta_price_diff_zero_ok() {
        // A
        assert_eq!(get_amount_delta_a(4 << 64, 4 << 64, 4, true).unwrap(), 0);
        assert_eq!(get_amount_delta_a(4 << 64, 4 << 64, 4, false).unwrap(), 0);

        // B
        assert_eq!(get_amount_delta_b(4 << 64, 4 << 64, 4, true).unwrap(), 0);
        assert_eq!(get_amount_delta_b(4 << 64, 4 << 64, 4, false).unwrap(), 0);
    }

    #[test]
    fn test_get_amount_delta_a_overflow() {
        assert!(get_amount_delta_a(1 << 64, 2 << 64, u128::MAX, true).is_err());
        assert!(get_amount_delta_a(1 << 64, 2 << 64, (u64::MAX as u128) << 1 + 1, true).is_err());
        assert!(get_amount_delta_a(1 << 64, 2 << 64, (u64::MAX as u128) << 1, true).is_ok());
        assert!(get_amount_delta_a(1 << 64, 2 << 64, u64::MAX as u128, true).is_ok());
    }
}
