use crate::errors::ErrorCode;
use crate::manager::swap_manager::*;
use crate::math::*;
use crate::state::{MAX_TICK_INDEX, MIN_TICK_INDEX, TICK_ARRAY_SIZE};
use crate::util::test_utils::swap_test_fixture::*;
use crate::util::{create_whirlpool_reward_infos, SwapTickSequence};
use serde::Deserialize;
use serde_json;
use serde_with::{serde_as, DisplayFromStr};
use solana_program::msg;
use std::cmp::{max, min};
use std::fs;

#[serde_as]
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TestCase {
    test_id: u16,
    description: String,
    tick_spacing: u16,
    fee_rate: u16,
    protocol_fee_rate: u16,
    #[serde_as(as = "DisplayFromStr")]
    liquidity: u128,
    curr_tick_index: i32,
    #[serde_as(as = "DisplayFromStr")]
    trade_amount: u64,
    amount_is_input: bool,
    a_to_b: bool,
    expectation: Expectation,
}

#[serde_as]
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expectation {
    exception: String,
    #[serde_as(as = "DisplayFromStr")]
    amount_a: u64,
    #[serde_as(as = "DisplayFromStr")]
    amount_b: u64,
    #[serde_as(as = "DisplayFromStr")]
    next_liquidity: u128,
    next_tick_index: i32,
    #[serde_as(as = "DisplayFromStr")]
    next_sqrt_price: u128,
    #[serde_as(as = "DisplayFromStr")]
    next_fee_growth_global: u128,
    #[serde_as(as = "DisplayFromStr")]
    next_protocol_fee: u64,
}

/// Current version of Anchor doesn't bubble up errors in a way
/// where we can compare. v0.23.0 has an updated format that will allow us to do so.
const CATCHABLE_ERRORS: [(&str, ErrorCode); 8] = [
    (
        "MultiplicationShiftRightOverflow",
        ErrorCode::MultiplicationShiftRightOverflow,
    ),
    ("TokenMaxExceeded", ErrorCode::TokenMaxExceeded),
    ("DivideByZero", ErrorCode::DivideByZero),
    ("SqrtPriceOutOfBounds", ErrorCode::SqrtPriceOutOfBounds),
    (
        "InvalidTickArraySequence",
        ErrorCode::InvalidTickArraySequence,
    ),
    ("ZeroTradableAmount", ErrorCode::ZeroTradableAmount),
    ("NumberDownCastError", ErrorCode::NumberDownCastError),
    ("MultiplicationOverflow", ErrorCode::MultiplicationOverflow),
];

#[test]
/// Run a collection of tests on the swap_manager against expectations
/// A total of 3840 tests on these variables:
/// 1. FeeRate ([MAX_FEE, MAX_PROTOCOL_FEE], [65535, 600], [700, 300], [0, 0])
/// 2. CurrentTickPosition (-443500, -223027, 0, 223027, 443500)
/// 3. Liquidity (0, 2^32, 2^64, 2^110)
/// 4. TickSpacing (1, 8, 128)
/// 5. TradeAmount (0, 10^9, 10^12, U64::max)
/// 6. Trade Direction (a->b, b->a)
/// 7. TradeAmountToken (amountIsInput, amountIsOutput)
fn run_swap_integration_tests() {
    let contents =
        fs::read_to_string("src/tests/swap_test_cases.json").expect("Failure to read the file.");
    let json: Vec<TestCase> = serde_json::from_str(&contents).expect("JSON was not well-formatted");
    let test_iterator = json.iter();

    let mut total_cases: u16 = 0;
    let mut pass_cases: u16 = 0;
    let mut fail_cases: u16 = 0;

    for test in test_iterator {
        let test_id = test.test_id;
        total_cases += 1;

        let derived_start_tick = derive_start_tick(test.curr_tick_index, test.tick_spacing);
        let last_tick_in_seq =
            derive_last_tick_in_seq(derived_start_tick, test.tick_spacing, test.a_to_b);

        let swap_test_info = SwapTestFixture::new(SwapTestFixtureInfo {
            tick_spacing: test.tick_spacing,
            liquidity: test.liquidity,
            curr_tick_index: test.curr_tick_index,
            start_tick_index: derived_start_tick,
            trade_amount: test.trade_amount,
            sqrt_price_limit: sqrt_price_from_tick_index(last_tick_in_seq),
            amount_specified_is_input: test.amount_is_input,
            a_to_b: test.a_to_b,
            array_1_ticks: &vec![],
            array_2_ticks: Some(&vec![]),
            array_3_ticks: Some(&vec![]),
            fee_growth_global_a: 0,
            fee_growth_global_b: 0,
            fee_rate: test.fee_rate,
            protocol_fee_rate: test.protocol_fee_rate,
            reward_infos: create_whirlpool_reward_infos(100, 10),
            ..Default::default()
        });

        let mut tick_sequence = SwapTickSequence::new(
            swap_test_info.tick_arrays[0].borrow_mut(),
            Some(swap_test_info.tick_arrays[1].borrow_mut()),
            Some(swap_test_info.tick_arrays[2].borrow_mut()),
        );
        let post_swap = swap_test_info.eval(&mut tick_sequence, 1643027024);

        if post_swap.is_err() {
            let e = post_swap.unwrap_err();

            if test.expectation.exception.is_empty() {
                fail_cases += 1;

                msg!("Test case {} - {}", test_id, test.description);
                msg!("Received an unexpected error - {}", e.to_string());
                msg!("");

                continue;
            }

            let expected_error = derive_error(&test.expectation.exception);

            if expected_error.is_none() {
                msg!("Test case {} - {}", test_id, test.description);
                msg!(
                    "Expectation expecting an unregistered error - {}. Test received this error - {}",
                    test.expectation.exception,
                    e.to_string()
                );
                msg!("");

                fail_cases += 1;
            } else if expected_error.is_some() && !anchor_lang::error!(expected_error.unwrap()).eq(&e) {
                fail_cases += 1;

                msg!("Test case {} - {}", test_id, test.description);
                msg!(
                    "Test case expected error - {}, but received - {}",
                    expected_error.unwrap().to_string(),
                    e.to_string()
                );
                msg!("");
            } else {
                pass_cases += 1;
            }
        } else {
            let expectation = &test.expectation;
            let results = post_swap.unwrap();
            let equal = assert_expectation(&results, expectation);

            if equal {
                pass_cases += 1;
            } else {
                msg!("Test case {} - {}", test_id, test.description);
                msg!("Fail - results do not equal.");

                if !expectation.exception.is_empty() {
                    msg!(
                        "Test case received no error but expected error - {}",
                        expectation.exception
                    );
                } else {
                    msg!(
                        "amount_a - {}, expect - {}",
                        results.amount_a,
                        expectation.amount_a
                    );
                    msg!(
                        "amount_b - {}, expect - {}",
                        results.amount_b,
                        expectation.amount_b
                    );
                    msg!(
                        "next_liq - {}, expect - {}",
                        results.next_liquidity,
                        expectation.next_liquidity
                    );
                    msg!(
                        "next_tick - {}, expect - {}",
                        results.next_tick_index,
                        expectation.next_tick_index
                    );
                    msg!(
                        "next_sqrt_price - {}, expect - {}",
                        results.next_sqrt_price,
                        expectation.next_sqrt_price
                    );
                    msg!(
                        "next_fee_growth_global - {}, expect - {}, delta - {}",
                        results.next_fee_growth_global,
                        expectation.next_fee_growth_global,
                        results.next_fee_growth_global as i128
                            - expectation.next_fee_growth_global as i128,
                    );
                    msg!(
                        "next_protocol_fee - {}, expect - {}",
                        results.next_protocol_fee,
                        expectation.next_protocol_fee
                    );
                }

                msg!("");

                fail_cases += 1;
            }
        }
    }
    msg!(
        "Total - {}, Pass - {}, Failed - {}",
        total_cases,
        pass_cases,
        fail_cases
    );
    assert_eq!(total_cases, pass_cases);
}

fn assert_expectation(post_swap: &PostSwapUpdate, expectation: &Expectation) -> bool {
    let amount_a_equal = post_swap.amount_a.eq(&expectation.amount_a);
    let amount_b_equal = post_swap.amount_b.eq(&expectation.amount_b);
    let next_liquidity_equal = post_swap.next_liquidity.eq(&expectation.next_liquidity);
    let next_tick_equal = post_swap.next_tick_index.eq(&expectation.next_tick_index);
    let next_sqrt_price_equal = post_swap.next_sqrt_price.eq(&expectation.next_sqrt_price);
    let next_fees_equal = post_swap
        .next_fee_growth_global
        .eq(&expectation.next_fee_growth_global);
    let next_protocol_fees_equal = post_swap
        .next_protocol_fee
        .eq(&expectation.next_protocol_fee);

    amount_a_equal
        && amount_b_equal
        && next_liquidity_equal
        && next_tick_equal
        && next_sqrt_price_equal
        && next_fees_equal
        && next_protocol_fees_equal
}

fn derive_error(expected_err: &String) -> Option<ErrorCode> {
    for possible_error in CATCHABLE_ERRORS {
        if expected_err.eq(&possible_error.0) {
            return Some(possible_error.1);
        }
    }
    return None;
}

/// Given a tick & tick-spacing, derive the start tick of the tick-array that this tick would reside in
fn derive_start_tick(curr_tick: i32, tick_spacing: u16) -> i32 {
    let num_of_ticks_in_array = TICK_ARRAY_SIZE * tick_spacing as i32;
    let rem = curr_tick % num_of_ticks_in_array;
    if curr_tick < 0 && rem != 0 {
        ((curr_tick / num_of_ticks_in_array) - 1) * num_of_ticks_in_array
    } else {
        curr_tick / num_of_ticks_in_array * num_of_ticks_in_array
    }
}

/// Given a start-tick & tick-spacing, derive the last tick of a 3-tick-array sequence
fn derive_last_tick_in_seq(start_tick: i32, tick_spacing: u16, a_to_b: bool) -> i32 {
    let num_of_ticks_in_array = TICK_ARRAY_SIZE * tick_spacing as i32;
    let potential_last = if a_to_b {
        start_tick - (2 * num_of_ticks_in_array)
    } else {
        start_tick + (3 * num_of_ticks_in_array) - 1
    };
    max(min(potential_last, MAX_TICK_INDEX), MIN_TICK_INDEX)
}
