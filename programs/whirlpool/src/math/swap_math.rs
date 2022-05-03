use std::convert::TryInto;

use crate::errors::ErrorCode;
use crate::math::*;

#[derive(PartialEq, Debug)]
pub struct SwapStepComputation {
    pub amount_in: u64,
    pub amount_out: u64,
    pub next_price: u128,
    pub fee_amount: u64,
}

pub fn compute_swap(
    amount_remaining: u64,
    fee_rate: u16,
    liquidity: u128,
    sqrt_price_current: u128,
    sqrt_price_target: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<SwapStepComputation, ErrorCode> {
    let fee_amount;

    let mut amount_fixed_delta = get_amount_fixed_delta(
        sqrt_price_current,
        sqrt_price_target,
        liquidity,
        amount_specified_is_input,
        a_to_b,
    )?;

    let mut amount_calc = amount_remaining;
    if amount_specified_is_input {
        amount_calc = checked_mul_div(
            amount_remaining as u128,
            FEE_RATE_MUL_VALUE - fee_rate as u128,
            FEE_RATE_MUL_VALUE,
        )?
        .try_into()?;
    }

    let next_sqrt_price = if amount_calc >= amount_fixed_delta {
        sqrt_price_target
    } else {
        get_next_sqrt_price(
            sqrt_price_current,
            liquidity,
            amount_calc,
            amount_specified_is_input,
            a_to_b,
        )?
    };

    let is_max_swap = next_sqrt_price == sqrt_price_target;

    let amount_unfixed_delta = get_amount_unfixed_delta(
        sqrt_price_current,
        next_sqrt_price,
        liquidity,
        amount_specified_is_input,
        a_to_b,
    )?;

    // If the swap is not at the max, we need to readjust the amount of the fixed token we are using
    if !is_max_swap {
        amount_fixed_delta = get_amount_fixed_delta(
            sqrt_price_current,
            next_sqrt_price,
            liquidity,
            amount_specified_is_input,
            a_to_b,
        )?;
    }

    let (amount_in, mut amount_out) = if amount_specified_is_input {
        (amount_fixed_delta, amount_unfixed_delta)
    } else {
        (amount_unfixed_delta, amount_fixed_delta)
    };

    // Cap output amount if using output
    if !amount_specified_is_input && amount_out > amount_remaining {
        amount_out = amount_remaining;
    }

    if amount_specified_is_input && !is_max_swap {
        fee_amount = amount_remaining - amount_in;
    } else {
        fee_amount = checked_mul_div_round_up(
            amount_in as u128,
            fee_rate as u128,
            FEE_RATE_MUL_VALUE - fee_rate as u128,
        )?
        .try_into()?;
    }

    Ok(SwapStepComputation {
        amount_in,
        amount_out,
        next_price: next_sqrt_price,
        fee_amount,
    })
}

fn get_amount_fixed_delta(
    sqrt_price_current: u128,
    sqrt_price_target: u128,
    liquidity: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<u64, ErrorCode> {
    if a_to_b == amount_specified_is_input {
        get_amount_delta_a(
            sqrt_price_current,
            sqrt_price_target,
            liquidity,
            amount_specified_is_input,
        )
    } else {
        get_amount_delta_b(
            sqrt_price_current,
            sqrt_price_target,
            liquidity,
            amount_specified_is_input,
        )
    }
}

fn get_amount_unfixed_delta(
    sqrt_price_current: u128,
    sqrt_price_target: u128,
    liquidity: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<u64, ErrorCode> {
    if a_to_b == amount_specified_is_input {
        get_amount_delta_b(
            sqrt_price_current,
            sqrt_price_target,
            liquidity,
            !amount_specified_is_input,
        )
    } else {
        get_amount_delta_a(
            sqrt_price_current,
            sqrt_price_target,
            liquidity,
            !amount_specified_is_input,
        )
    }
}

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_compute_swap(
            amount in 1..u64::MAX,
            liquidity in 1..u32::MAX as u128,
            fee_rate in 1..u16::MAX,
            price_0 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            price_1 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            amount_specified_is_input in proptest::bool::ANY,
        ) {
            prop_assume!(price_0 != price_1);

            // Rather than use logic to correctly input the prices, we just use the distribution to determine direction
            let a_to_b = price_0 >= price_1;

            let swap_computation = compute_swap(
                amount,
                fee_rate,
                liquidity,
                price_0,
                price_1,
                amount_specified_is_input,
                a_to_b,
            ).ok().unwrap();

            let amount_in = swap_computation.amount_in;
            let amount_out = swap_computation.amount_out;
            let next_price = swap_computation.next_price;
            let fee_amount = swap_computation.fee_amount;

            // Amount_in can not exceed maximum amount
            assert!(amount_in <= u64::MAX - fee_amount);

            // Amounts calculated are less than amount specified
            let amount_used = if amount_specified_is_input {
                amount_in + fee_amount
            } else {
                amount_out
            };

            if next_price != price_1 {
                assert!(amount_used == amount);
            } else {
                assert!(amount_used <= amount);
            }

            let (price_lower, price_upper) = increasing_price_order(price_0, price_1);
            assert!(next_price >= price_lower);
            assert!(next_price <= price_upper);
        }

        #[test]
        fn test_compute_swap_inversion(
            amount in 1..u64::MAX,
            liquidity in 1..u32::MAX as u128,
            fee_rate in 1..u16::MAX,
            price_0 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            price_1 in MIN_SQRT_PRICE_X64..MAX_SQRT_PRICE_X64,
            amount_specified_is_input in proptest::bool::ANY,
        ) {
            prop_assume!(price_0 != price_1);

            // Rather than use logic to correctly input the prices, we just use the distribution to determine direction
            let a_to_b = price_0 >= price_1;

            let swap_computation = compute_swap(
                amount,
                fee_rate,
                liquidity,
                price_0,
                price_1,
                amount_specified_is_input,
                a_to_b,
            ).ok().unwrap();

            let amount_in = swap_computation.amount_in;
            let amount_out = swap_computation.amount_out;
            let next_price = swap_computation.next_price;
            let fee_amount = swap_computation.fee_amount;

            let inverted_amount = if amount_specified_is_input {
                amount_out
            } else {
                amount_in + fee_amount
            };

            if inverted_amount != 0 {
                let inverted = compute_swap(
                    inverted_amount,
                    fee_rate,
                    liquidity,
                    price_0,
                    price_1,
                    !amount_specified_is_input,
                    a_to_b,
                ).ok().unwrap();

                // A to B = price decreasing

                // Case 1
                // Normal: is_input, a_to_b
                // Input is fixed, consume all input to produce amount_out
                // amount_in = fixed, ceil
                // amount_out = unfixed, floor

                // Inverted: !is_input, a_to_b
                // amount_in = unfixed, ceil
                // amount_out = fixed, floor
                // Amount = amount_out, inverted.amount_in and fee <= original input and fee, inverted.amount_out ~~ amount_out, inverted.next_price >= original.next_price


                // Case 2
                // Normal: !is_input, a_to_b
                // Find amount required to get amount_out
                // amount_in = unfixed, ceil
                // amount_out = fixed, floor

                // Inverted: is_input, a_to_b
                // amount_in = fixed, ceil
                // amount_out = unfixed, floor
                // Get max amount_out for input, inverted.amount_in + fee ~~ original input and fee, inverted.amount_out >= amount_out, inverted.next_price <= original.next_price


                // Price increasing
                // Case 3
                // Normal: is_input, !a_to_b
                // Input is fixed, consume all input to produce amount_out
                // amount_in = fixed, ceil
                // amount_out = unfixed, floor

                // Inverted: !is_input, !a_to_b
                // Amount = amount_out, inverted.amount_in and fee <= original input and fee, inverted.amount_out ~~ amount_out, inverted.next_price <= original.next_price

                // Case 4
                // Normal: !is_input, !a_to_b
                // Find amount required to get amount_out
                // amount_in = fixed, floor
                // amount_out = unfixed, ceil
                // Inverted: is_input, !a_to_b
                // Get max amount_out for input, inverted.amount_in + fee ~~ original input and fee, inverted.amount_out >= amount_out
                // Since inverted.amount_out >= amount_out and amount in is the same, more of token a is being removed, so
                // inverted.next_price >= original.next_price

                // Next sqrt price goes from round up to round down
                // assert!(inverted.next_price + 1 >= next_price);

                if inverted.next_price != price_1 {
                    if amount_specified_is_input {
                        // If a_to_b, then goes round up => round down,
                        assert!(inverted.amount_in <= amount_in);
                        assert!(inverted.fee_amount <= fee_amount);
                    } else {
                        assert!(inverted.amount_in >= amount_in);
                        assert!(inverted.fee_amount >= fee_amount);
                    }
                    assert!(inverted.amount_out >= amount_out);
                    if a_to_b == amount_specified_is_input {
                        // Next sqrt price goes from round up to round down
                        assert!(inverted.next_price >= next_price);
                    } else {
                        // Next sqrt price goes from round down to round up
                        assert!(inverted.next_price <= next_price);
                    }

                    // Ratio calculations
                    // let ratio_in = (u128::from(inverted.amount_in) << 64) / u128::from(amount_in);
                    // let ratio_out = (u128::from(inverted.amount_out) << 64) / u128::from(amount_out);
                    // println!("RATIO IN/OUT WHEN INVERTED {} \t| {} ", ratio_in, ratio_out);

                    // if ratio_out > (2 << 64) || ratio_in < (1 << 63) {
                    //     if ratio_out > (2 << 64) {
                    //         println!("OUT > {}", ratio_out / (1 << 64));
                    //     }
                    //     if ratio_in < (1 << 63) {
                    //         println!("IN < 1/{}", (1 << 64) / ratio_in);
                    //     }

                    //     println!("liq {} | fee {} | price_0 {} | price_1 {} | a_to_b {}", liquidity, fee_rate, price_0, price_1, a_to_b);
                    //     println!("Amount {} | is_input {}", amount, amount_specified_is_input);
                    //     println!("Inverted Amount {} | is_input {}", inverted_amount, !amount_specified_is_input);
                    //     println!("{:?}", swap_computation);
                    //     println!("{:?}", inverted);
                    // }
                }
            }
        }
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    mod test_swap {
        // Doesn't cross any additional ticks
        mod no_cross {
            use super::*;

            #[test]
            fn swap_a_to_b_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output_partial() {
                validate_tick_whirlpool();
            }
        }

        // Crosses single initialized tick
        mod single_tick {
            use super::*;

            #[test]
            fn swap_a_to_b_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output_partial() {
                validate_tick_whirlpool();
            }
        }

        // Crosses multiple initialized ticks
        mod multi_tick {
            use super::*;

            #[test]
            fn swap_a_to_b_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output_partial() {
                validate_tick_whirlpool();
            }
        }

        // Crosses a multiple ticks with a zone of 0 liquidity
        mod discontiguous_multi_tick {
            use super::*;

            #[test]
            fn swap_a_to_b_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_a_to_b_output_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_input_partial() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output() {
                validate_tick_whirlpool();
            }

            #[test]
            fn swap_b_to_a_output_partial() {
                validate_tick_whirlpool();
            }
        }

        mod protocol_rate {
            use super::*;

            #[test]
            fn protocol_rate() {
                validate_tick_whirlpool();
            }

            #[test]
            fn protocol_rate_zero() {
                validate_tick_whirlpool();
            }
        }

        fn validate_tick_whirlpool() {
            // Validate tick values
            // Fee, reward growths
            //
            // Validate whirlpool values
            // liquidity, tick, sqrt_price, fee_growth, reward, protocol fee, token amounts
        }
    }

    mod test_compute_swap {
        const TWO_PCT: u16 = 20000;
        use std::convert::TryInto;

        use super::*;
        use crate::math::bit_math::Q64_RESOLUTION;

        #[test]
        fn swap_a_to_b_input() {
            // Example calculation
            let amount = 100u128;
            let init_liq = 1296;
            let init_price = 9;
            let price_limit = 4;

            // Calculate fee given fee percentage
            let fee_amount = div_round_up((amount * u128::from(TWO_PCT)).into(), 1_000_000)
                .ok()
                .unwrap();

            // Calculate initial a and b given L and sqrt(P)
            let init_b = init_liq * init_price;
            let init_a = init_liq / init_price;

            // Calculate amount_in given fee_percentage
            let amount_in = amount - fee_amount;

            // Swapping a to b =>
            let new_a = init_a + amount_in;

            // Calculate next price
            let next_price = div_round_up(init_liq << Q64_RESOLUTION, new_a)
                .ok()
                .unwrap();

            // b - new_b
            let amount_out = init_b - div_round_up(init_liq * init_liq, new_a).ok().unwrap();
            test_swap(
                100,
                TWO_PCT,                      // 2 % fee
                init_liq.try_into().unwrap(), // sqrt(ab)
                // Current
                // b = 1296 * 9 => 11664
                // a = 1296 / 9 => 144
                init_price << Q64_RESOLUTION, // sqrt (b/a)
                // New
                // a = 144 + 98 => 242 => 1296 / sqrt(P) = 242 => sqrt(P) = 1296 /242
                // next b = 1296 * 1296 / 242 => 6940
                price_limit << Q64_RESOLUTION,
                true,
                true,
                SwapStepComputation {
                    amount_in: amount_in.try_into().unwrap(),
                    amount_out: amount_out.try_into().unwrap(),
                    next_price,
                    fee_amount: fee_amount.try_into().unwrap(),
                },
            );
        }

        #[test]
        fn swap_a_to_b_input_zero() {
            test_swap(
                0,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                true,
                false,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 9 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_a_to_b_input_zero_liq() {
            test_swap(
                100,
                TWO_PCT,
                0,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                true,
                false,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 4 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_a_to_b_input_max() {
            test_swap(
                1000,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                true,
                true,
                SwapStepComputation {
                    amount_in: 180,
                    amount_out: 6480,
                    next_price: 4 << Q64_RESOLUTION,
                    fee_amount: 4,
                },
            );
        }

        #[test]
        fn swap_a_to_b_input_max_1pct_fee() {
            test_swap(
                1000,
                TWO_PCT / 2,
                1296,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                true,
                true,
                SwapStepComputation {
                    amount_in: 180,
                    amount_out: 6480,
                    next_price: 4 << Q64_RESOLUTION,
                    fee_amount: 2,
                },
            );
        }

        #[test]
        fn swap_a_to_b_output() {
            test_swap(
                4723,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                false,
                true,
                SwapStepComputation {
                    amount_in: 98,
                    amount_out: 4723,
                    next_price: 98795409425631171116,
                    fee_amount: 2,
                },
            );
        }

        #[test]
        fn swap_a_to_b_output_max() {
            test_swap(
                10000,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                false,
                true,
                SwapStepComputation {
                    amount_in: 180,
                    amount_out: 6480,
                    next_price: 4 << Q64_RESOLUTION,
                    fee_amount: 4,
                },
            );
        }

        #[test]
        fn swap_a_to_b_output_zero() {
            test_swap(
                0,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                false,
                true,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 9 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_a_to_b_output_zero_liq() {
            test_swap(
                100,
                TWO_PCT,
                0,
                9 << Q64_RESOLUTION,
                4 << Q64_RESOLUTION,
                false,
                true,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 4 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_b_to_a_input() {
            test_swap(
                2000,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                true,
                false,
                SwapStepComputation {
                    amount_in: 1960,
                    amount_out: 20,
                    next_price: 193918550355107200012,
                    fee_amount: 40,
                },
            );
        }

        #[test]
        fn swap_b_to_a_input_max() {
            test_swap(
                20000,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                true,
                false,
                SwapStepComputation {
                    amount_in: 9072,
                    amount_out: 63,
                    next_price: 16 << Q64_RESOLUTION,
                    fee_amount: 186,
                },
            );
        }

        #[test]
        fn swap_b_to_a_input_zero() {
            test_swap(
                0,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                true,
                false,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 9 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_b_to_a_input_zero_liq() {
            test_swap(
                100,
                TWO_PCT,
                0,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                true,
                false,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 16 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_b_to_a_output() {
            test_swap(
                20,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                false,
                false,
                SwapStepComputation {
                    amount_in: 1882,
                    amount_out: 20,
                    next_price: 192798228383286926568,
                    fee_amount: 39,
                },
            );
        }

        #[test]
        fn swap_b_to_a_output_max() {
            test_swap(
                80,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                false,
                false,
                SwapStepComputation {
                    amount_in: 9072,
                    amount_out: 63,
                    next_price: 16 << Q64_RESOLUTION,
                    fee_amount: 186,
                },
            );
        }

        #[test]
        fn swap_b_to_a_output_zero() {
            test_swap(
                0,
                TWO_PCT,
                1296,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                false,
                false,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 9 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }

        #[test]
        fn swap_b_to_a_output_zero_liq() {
            test_swap(
                100,
                TWO_PCT,
                0,
                9 << Q64_RESOLUTION,
                16 << Q64_RESOLUTION,
                false,
                false,
                SwapStepComputation {
                    amount_in: 0,
                    amount_out: 0,
                    next_price: 16 << Q64_RESOLUTION,
                    fee_amount: 0,
                },
            );
        }
    }

    fn test_swap(
        amount_remaining: u64,
        fee_rate: u16,
        liquidity: u128,
        sqrt_price_current: u128,
        sqrt_price_target_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
        expected: SwapStepComputation,
    ) {
        let swap_computation = compute_swap(
            amount_remaining,
            fee_rate,
            liquidity,
            sqrt_price_current,
            sqrt_price_target_limit,
            amount_specified_is_input,
            a_to_b,
        );
        assert_eq!(swap_computation.ok().unwrap(), expected);
    }
}
