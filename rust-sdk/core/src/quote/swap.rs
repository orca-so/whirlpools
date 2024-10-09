use core::cmp::{max, min};

use crate::{
    adjust_amount, get_amount_delta_a, get_amount_delta_b, get_next_sqrt_price_from_a,
    get_next_sqrt_price_from_b, inverse_adjust_amount, sqrt_price_to_tick_index,
    tick_index_to_sqrt_price, AdjustmentType, ExactInSwapQuote, ExactOutSwapQuote, TickArrayFacade,
    TickArraySequence, TickFacade, TransferFee, WhirlpoolFacade, U128,
};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

const MIN_SQRT_PRICE: u128 = 4295048016;
const MAX_SQRT_PRICE: u128 = 79226673515401279992447579055;

/// Computes the exact input or output amount for a swap transaction.
///
/// # Arguments
/// - `token_in`: The input token amount.
/// - `specified_token_a`: If `true`, the input token is token A. Otherwise, it is token B.
/// - `slippage_tolerance`: The slippage tolerance in basis points.
/// - `whirlpool`: The whirlpool state.
/// - `tick_array_0`: The tick array at the current tick index.
/// - `tick_array_plus_1`: The tick array at the current tick offset plus 1.
/// - `tick_array_plus_2`: The tick array at the current tick offset plus 2.
/// - `tick_array_minus_1`: The tick array at the current tick offset minus 1.
/// - `tick_array_minus_2`: The tick array at the current tick offset minus 2.
/// - `transfer_fee_a`: The transfer fee for token A.
/// - `transfer_fee_b`: The transfer fee for token B.
///
/// # Returns
/// The exact input or output amount for the swap transaction.
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = swapQuoteByInputToken, skip_jsdoc))]
pub fn swap_quote_by_input_token(
    token_in: U128,
    specified_token_a: bool,
    slippage_tolerance: u16,
    whirlpool: WhirlpoolFacade,
    tick_array_0: TickArrayFacade,
    tick_array_plus_1: TickArrayFacade,
    tick_array_plus_2: TickArrayFacade,
    tick_array_minus_1: TickArrayFacade,
    tick_array_minus_2: TickArrayFacade,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> ExactInSwapQuote {
    let (transfer_fee_in, transfer_fee_out) = if specified_token_a {
        (transfer_fee_b, transfer_fee_a)
    } else {
        (transfer_fee_a, transfer_fee_b)
    };
    let token_in_after_fee = adjust_amount(token_in.into(), transfer_fee_in.into(), false);

    let tick_sequence = TickArraySequence::new(
        [
            tick_array_minus_2,
            tick_array_minus_1,
            tick_array_0,
            tick_array_plus_1,
            tick_array_plus_2,
        ],
        whirlpool.tick_spacing,
    );

    let swap_result = compute_swap(
        token_in_after_fee.into(),
        whirlpool,
        tick_sequence,
        specified_token_a,
        true,
    );

    let (token_in_after_fees, token_est_out_before_fee) = if specified_token_a {
        (swap_result.token_a, swap_result.token_b)
    } else {
        (swap_result.token_b, swap_result.token_a)
    };

    let token_min_out_before_fee = adjust_amount(
        token_est_out_before_fee.into(),
        AdjustmentType::Slippage { slippage_tolerance },
        false,
    );

    let token_in = inverse_adjust_amount(token_in_after_fees.into(), transfer_fee_in.into(), false);
    let token_est_out = adjust_amount(
        token_est_out_before_fee.into(),
        transfer_fee_out.into(),
        false,
    );
    let token_min_out = adjust_amount(
        token_min_out_before_fee.into(),
        transfer_fee_out.into(),
        false,
    );

    ExactInSwapQuote {
        token_in: token_in.into(),
        token_est_out: token_est_out.into(),
        token_min_out: token_min_out.into(),
        total_fee: swap_result.total_fee,
    }
}

/// Computes the exact input or output amount for a swap transaction.
///
/// # Arguments
/// - `token_out`: The output token amount.
/// - `specified_token_a`: If `true`, the output token is token A. Otherwise, it is token B.
/// - `slippage_tolerance`: The slippage tolerance in basis points.
/// - `whirlpool`: The whirlpool state.
/// - `tick_array_0`: The tick array at the current tick index.
/// - `tick_array_plus_1`: The tick array at the current tick offset plus 1.
/// - `tick_array_plus_2`: The tick array at the current tick offset plus 2.
/// - `tick_array_minus_1`: The tick array at the current tick offset minus 1.
/// - `tick_array_minus_2`: The tick array at the current tick offset minus 2.
/// - `transfer_fee_a`: The transfer fee for token A.
/// - `transfer_fee_b`: The transfer fee for token B.
///
/// # Returns
/// The exact input or output amount for the swap transaction.
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = swapQuoteByOutputToken, skip_jsdoc))]
pub fn swap_quote_by_output_token(
    token_out: U128,
    specified_token_a: bool,
    slippage_tolerance: u16,
    whirlpool: WhirlpoolFacade,
    tick_array_0: TickArrayFacade,
    tick_array_plus_1: TickArrayFacade,
    tick_array_plus_2: TickArrayFacade,
    tick_array_minus_1: TickArrayFacade,
    tick_array_minus_2: TickArrayFacade,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> ExactOutSwapQuote {
    let (transfer_fee_in, transfer_fee_out) = if specified_token_a {
        (transfer_fee_b, transfer_fee_a)
    } else {
        (transfer_fee_a, transfer_fee_b)
    };
    let token_out_before_fee =
        inverse_adjust_amount(token_out.into(), transfer_fee_out.into(), false);

    let tick_sequence = TickArraySequence::new(
        [
            tick_array_minus_2,
            tick_array_minus_1,
            tick_array_0,
            tick_array_plus_1,
            tick_array_plus_2,
        ],
        whirlpool.tick_spacing,
    );

    let swap_result = compute_swap(
        token_out_before_fee.into(),
        whirlpool,
        tick_sequence,
        !specified_token_a,
        false,
    );

    let (token_out_before_fee, token_est_in_after_fee) = if specified_token_a {
        (swap_result.token_a, swap_result.token_b)
    } else {
        (swap_result.token_b, swap_result.token_a)
    };

    let token_max_in_after_fee = adjust_amount(
        token_est_in_after_fee.into(),
        AdjustmentType::Slippage { slippage_tolerance },
        true,
    );

    let token_est_in =
        inverse_adjust_amount(token_est_in_after_fee.into(), transfer_fee_in.into(), false);
    let token_max_in =
        inverse_adjust_amount(token_max_in_after_fee.into(), transfer_fee_in.into(), false);
    let token_out = adjust_amount(token_out_before_fee.into(), transfer_fee_out.into(), false);

    ExactOutSwapQuote {
        token_out: token_out.into(),
        token_est_in: token_est_in.into(),
        token_max_in: token_max_in.into(),
        total_fee: swap_result.total_fee,
    }
}

// Private functions

struct SwapResult {
    token_a: u128,
    token_b: u128,
    total_fee: u128,
}

fn compute_swap<const SIZE: usize>(
    token_amount: u128,
    whirlpool: WhirlpoolFacade,
    tick_sequence: TickArraySequence<SIZE>,
    a_to_b: bool,
    specified_input: bool,
) -> SwapResult {
    let mut amount_remaining = token_amount;
    let mut amount_calculated = 0u128;
    let mut current_sqrt_price = whirlpool.sqrt_price;
    let mut current_tick_index = whirlpool.tick_current_index;
    let mut current_liquidity = whirlpool.liquidity;
    let mut total_fee = 0u128;

    while amount_remaining > 0
        && current_sqrt_price > MIN_SQRT_PRICE
        && current_sqrt_price < MAX_SQRT_PRICE
    {
        let (next_tick, next_tick_index) = if a_to_b {
            tick_sequence.next_initialized_tick(current_tick_index)
        } else {
            tick_sequence.prev_initialized_tick(current_tick_index)
        };
        let next_tick_sqrt_price: u128 = tick_index_to_sqrt_price(next_tick_index.into()).into();
        let target_sqrt_price = if a_to_b {
            max(next_tick_sqrt_price, MIN_SQRT_PRICE)
        } else {
            min(next_tick_sqrt_price, MAX_SQRT_PRICE)
        };

        let step_quote = compute_swap_step(
            amount_remaining,
            whirlpool.fee_rate,
            current_liquidity,
            current_sqrt_price,
            target_sqrt_price,
            a_to_b,
            specified_input,
        );

        total_fee += step_quote.fee_amount;

        if specified_input {
            amount_remaining -= step_quote.amount_in + step_quote.fee_amount;
            amount_calculated += step_quote.amount_out;
        } else {
            amount_remaining -= step_quote.amount_out;
            amount_calculated += step_quote.amount_in + step_quote.fee_amount;
        }

        if step_quote.next_sqrt_price == next_tick_sqrt_price {
            current_liquidity = get_next_liquidity(current_liquidity, next_tick, a_to_b);
            current_tick_index = next_tick_index;
        } else {
            current_tick_index = sqrt_price_to_tick_index(step_quote.next_sqrt_price.into()).into();
        }

        current_sqrt_price = step_quote.next_sqrt_price;
    }

    let swapped_amount = token_amount - amount_remaining;
    let token_a = if a_to_b == specified_input {
        swapped_amount
    } else {
        amount_calculated
    };
    let token_b = if a_to_b == specified_input {
        amount_calculated
    } else {
        swapped_amount
    };

    SwapResult {
        token_a,
        token_b,
        total_fee,
    }
}

fn get_next_liquidity(current_liquidity: u128, next_tick: &TickFacade, a_to_b: bool) -> u128 {
    let liquidity_net = next_tick.liquidity_net;
    let liquidity_net_unsigned = liquidity_net.unsigned_abs();
    if a_to_b {
        if liquidity_net < 0 {
            current_liquidity + liquidity_net_unsigned
        } else {
            current_liquidity - liquidity_net_unsigned
        }
    } else if liquidity_net < 0 {
        current_liquidity - liquidity_net_unsigned
    } else {
        current_liquidity + liquidity_net_unsigned
    }
}

struct SwapStepQuote {
    amount_in: u128,
    amount_out: u128,
    next_sqrt_price: u128,
    fee_amount: u128,
}

fn compute_swap_step(
    amount_remaining: u128,
    fee_rate: u16,
    current_liquidity: u128,
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    a_to_b: bool,
    specified_input: bool,
) -> SwapStepQuote {
    let mut amount_fixed_delta = get_amount_fixed_delta(
        current_sqrt_price,
        target_sqrt_price,
        current_liquidity,
        a_to_b,
        specified_input,
    );

    let amount_calculated: u128 = if specified_input {
        adjust_amount(
            amount_remaining.into(),
            AdjustmentType::SwapFee { fee_rate },
            false,
        )
        .into()
    } else {
        amount_remaining
    };

    let next_sqrt_price = if amount_calculated >= amount_fixed_delta {
        target_sqrt_price
    } else {
        get_next_sqrt_price(
            current_sqrt_price,
            current_liquidity,
            amount_calculated,
            a_to_b,
            specified_input,
        )
    };

    let is_max_swap = next_sqrt_price == target_sqrt_price;

    let amount_unfixed_delta = get_amount_unfixed_delta(
        current_sqrt_price,
        next_sqrt_price,
        current_liquidity,
        a_to_b,
        specified_input,
    );

    // If the swap is not at the max, we need to readjust the amount of the fixed token we are using
    if !is_max_swap {
        amount_fixed_delta = get_amount_fixed_delta(
            current_sqrt_price,
            next_sqrt_price,
            current_liquidity,
            a_to_b,
            specified_input,
        );
    };

    let (amount_in, mut amount_out) = if specified_input {
        (amount_fixed_delta, amount_unfixed_delta)
    } else {
        (amount_unfixed_delta, amount_fixed_delta)
    };

    // Cap output amount if using output
    if !specified_input && amount_out > amount_remaining {
        amount_out = amount_remaining;
    }

    let fee_amount: u128 = if specified_input && !is_max_swap {
        amount_remaining - amount_in
    } else {
        let pre_fee_amount: u128 = inverse_adjust_amount(
            amount_in.into(),
            AdjustmentType::SwapFee { fee_rate },
            false,
        )
        .into();
        pre_fee_amount - amount_in
    };

    SwapStepQuote {
        amount_in,
        amount_out,
        next_sqrt_price,
        fee_amount,
    }
}

fn get_amount_fixed_delta(
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    current_liquidity: u128,
    a_to_b: bool,
    specified_input: bool,
) -> u128 {
    if a_to_b == specified_input {
        get_amount_delta_a(
            current_sqrt_price.into(),
            target_sqrt_price.into(),
            current_liquidity.into(),
            specified_input,
        )
        .into()
    } else {
        get_amount_delta_b(
            current_sqrt_price.into(),
            target_sqrt_price.into(),
            current_liquidity.into(),
            specified_input,
        )
        .into()
    }
}

fn get_amount_unfixed_delta(
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    current_liquidity: u128,
    a_to_b: bool,
    specified_input: bool,
) -> u128 {
    if specified_input == a_to_b {
        get_amount_delta_b(
            current_sqrt_price.into(),
            target_sqrt_price.into(),
            current_liquidity.into(),
            !specified_input,
        )
        .into()
    } else {
        get_amount_delta_a(
            current_sqrt_price.into(),
            target_sqrt_price.into(),
            current_liquidity.into(),
            !specified_input,
        )
        .into()
    }
}

fn get_next_sqrt_price(
    current_sqrt_price: u128,
    current_liquidity: u128,
    amount_calculated: u128,
    a_to_b: bool,
    specified_input: bool,
) -> u128 {
    if specified_input == a_to_b {
        get_next_sqrt_price_from_a(
            current_sqrt_price.into(),
            current_liquidity.into(),
            amount_calculated.into(),
            specified_input,
        )
        .into()
    } else {
        get_next_sqrt_price_from_b(
            current_sqrt_price.into(),
            current_liquidity.into(),
            amount_calculated.into(),
            specified_input,
        )
        .into()
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use crate::TICK_ARRAY_SIZE;

    use super::*;

    fn test_whirlpool(sqrt_price: u128, sufficient_liq: bool) -> WhirlpoolFacade {
        let tick_current_index = sqrt_price_to_tick_index(sqrt_price);
        let liquidity = if sufficient_liq { 100000000 } else { 100000 };
        WhirlpoolFacade {
            tick_current_index,
            fee_rate: 3000,
            liquidity,
            sqrt_price,
            tick_spacing: 2,
            ..WhirlpoolFacade::default()
        }
    }

    fn test_tick(positive: bool) -> TickFacade {
        let liquidity_net = if positive { 1000 } else { -1000 };
        TickFacade {
            initialized: true,
            liquidity_net,
            ..TickFacade::default()
        }
    }

    fn test_tick_array(start_tick_index: i32) -> TickArrayFacade {
        let positive_liq_net = start_tick_index < 0;
        TickArrayFacade {
            start_tick_index,
            ticks: [test_tick(positive_liq_net); TICK_ARRAY_SIZE],
        }
    }

    #[test]
    fn test_exact_in_a_to_b_simple() {
        let result = swap_quote_by_input_token(
            1000,
            true,
            1000,
            test_whirlpool(1 << 64, true),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );
        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 996);
        assert_eq!(result.token_min_out, 896);
        assert_eq!(result.total_fee, 3);
    }

    #[test]
    fn test_exact_in_a_to_b() {
        let result = swap_quote_by_input_token(
            1000,
            true,
            1000,
            test_whirlpool(1 << 64, false),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );
        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 871);
        assert_eq!(result.token_min_out, 783);
        assert_eq!(result.total_fee, 68);
    }

    #[test]
    fn test_exact_in_b_to_a_simple() {
        let result = swap_quote_by_input_token(
            1000,
            false,
            1000,
            test_whirlpool(1 << 64, true),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );

        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 996);
        assert_eq!(result.token_min_out, 896);
        assert_eq!(result.total_fee, 3);
    }

    #[test]
    fn test_exact_in_b_to_a() {
        let result = swap_quote_by_input_token(
            1000,
            false,
            1000,
            test_whirlpool(1 << 64, false),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );

        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 872);
        assert_eq!(result.token_min_out, 784);
        assert_eq!(result.total_fee, 68);
    }

    #[test]
    fn test_exact_out_a_to_b_simple() {
        let result = swap_quote_by_output_token(
            1000,
            false,
            1000,
            test_whirlpool(1 << 64, true),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1005);
        assert_eq!(result.token_max_in, 1106);
        assert_eq!(result.total_fee, 4);
    }

    #[test]
    fn test_exact_out_a_to_b() {
        let result = swap_quote_by_output_token(
            1000,
            false,
            1000,
            test_whirlpool(1 << 64, false),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1142);
        assert_eq!(result.token_max_in, 1257);
        assert_eq!(result.total_fee, 76);
    }

    #[test]
    fn test_exact_out_b_to_a_simple() {
        let result = swap_quote_by_output_token(
            1000,
            true,
            1000,
            test_whirlpool(1 << 64, true),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1005);
        assert_eq!(result.token_max_in, 1106);
        assert_eq!(result.total_fee, 4);
    }

    #[test]
    fn test_exact_out_b_to_a() {
        let result = swap_quote_by_output_token(
            1000,
            true,
            1000,
            test_whirlpool(1 << 64, false),
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
            None,
            None,
        );
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1141);
        assert_eq!(result.token_max_in, 1256);
        assert_eq!(result.total_fee, 76);
    }

    // TODO: add more complex tests that
    // * only fill partially
    // * transfer fee
}
