use crate::{
    math::{ceil_division, floor_division, sqrt_price_from_tick_index, tick_index_from_sqrt_price},
    state::{
        AdaptiveFeeConstants, AdaptiveFeeInfo, AdaptiveFeeVariables, MAX_TICK_INDEX, MIN_TICK_INDEX,
    },
};
use anchor_lang::prelude::*;

// This constant is used to scale the value of the volatility accumulator.
// The value of the volatility accumulator is decayed by the reduction factor and used as a new reference.
// However, if the volatility accumulator is simply the difference in tick_group_index, a value of 1 would quickly decay to 0.
// By scaling 1 to 10,000, for example, if the reduction factor is 0.5, the resulting value would be 5,000.
pub const VOLATILITY_ACCUMULATOR_SCALE_FACTOR: u16 = 10_000;

// The denominator of the reduction factor.
// When the reduction_factor is 5_000, the reduction factor functions as 0.5.
pub const REDUCTION_FACTOR_DENOMINATOR: u16 = 10_000;

// adaptive_fee_control_factor is used to map the square of the volatility accumulator to the fee rate.
// A larger value increases the fee rate quickly even for small volatility, while a smaller value increases the fee rate more gradually even for high volatility.
// When the adaptive_fee_control_factor is 1_000, the adaptive fee control factor functions as 0.01.
pub const ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR: u32 = 100_000;

// max fee rate should be controlled by max_volatility_accumulator, so this is a hard limit for safety.
// Fee rate is represented as hundredths of a basis point.
pub const FEE_RATE_HARD_LIMIT: u32 = 100_000; // 10%

// The time (in seconds) to forcibly reset the reference if it is not updated for a long time.
// A recovery measure against the act of intentionally repeating major swaps to keep the Adaptive Fee high (DoS).
pub const MAX_REFERENCE_AGE: u64 = 3_600; // 1 hour

#[derive(Debug)]
pub enum FeeRateManager {
    Adaptive {
        a_to_b: bool,
        tick_group_index: i32,
        static_fee_rate: u16,
        adaptive_fee_constants: AdaptiveFeeConstants,
        adaptive_fee_variables: AdaptiveFeeVariables,
        core_tick_group_range_lower_bound: Option<(i32, u128)>,
        core_tick_group_range_upper_bound: Option<(i32, u128)>,
    },
    Static {
        static_fee_rate: u16,
    },
}

impl FeeRateManager {
    pub fn new(
        a_to_b: bool,
        current_tick_index: i32,
        timestamp: u64,
        static_fee_rate: u16,
        adaptive_fee_info: Option<AdaptiveFeeInfo>,
    ) -> Result<Self> {
        match adaptive_fee_info {
            None => Ok(Self::Static { static_fee_rate }),
            Some(adaptive_fee_info) => {
                let tick_group_index = floor_division(
                    current_tick_index,
                    adaptive_fee_info.constants.tick_group_size as i32,
                );
                let adaptive_fee_constants = adaptive_fee_info.constants;
                let mut adaptive_fee_variables = adaptive_fee_info.variables;

                // update reference at the initialization of the fee rate manager
                adaptive_fee_variables.update_reference(
                    tick_group_index,
                    timestamp,
                    &adaptive_fee_constants,
                )?;

                // max_volatility_accumulator < volatility_reference + tick_group_index_delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                // -> ceil((max_volatility_accumulator - volatility_reference) / VOLATILITY_ACCUMULATOR_SCALE_FACTOR) < tick_group_index_delta
                // From the above, if tick_group_index_delta is sufficiently large, volatility_accumulator always sticks to max_volatility_accumulator
                #[allow(clippy::manual_div_ceil)]
                let max_volatility_accumulator_tick_group_index_delta = ((adaptive_fee_constants
                    .max_volatility_accumulator
                    - adaptive_fee_variables.volatility_reference)
                    + VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32
                    - 1)
                    / VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;

                // we need to calculate the adaptive fee rate for each tick_group_index in the range of core tick group
                let core_tick_group_range_lower_index = adaptive_fee_variables
                    .tick_group_index_reference
                    - max_volatility_accumulator_tick_group_index_delta as i32;
                let core_tick_group_range_upper_index = adaptive_fee_variables
                    .tick_group_index_reference
                    + max_volatility_accumulator_tick_group_index_delta as i32;
                let core_tick_group_range_lower_bound_tick_index = core_tick_group_range_lower_index
                    * adaptive_fee_constants.tick_group_size as i32;
                let core_tick_group_range_upper_bound_tick_index = core_tick_group_range_upper_index
                    * adaptive_fee_constants.tick_group_size as i32
                    + adaptive_fee_constants.tick_group_size as i32;

                let core_tick_group_range_lower_bound =
                    if core_tick_group_range_lower_bound_tick_index > MIN_TICK_INDEX {
                        Some((
                            core_tick_group_range_lower_index,
                            sqrt_price_from_tick_index(
                                core_tick_group_range_lower_bound_tick_index,
                            ),
                        ))
                    } else {
                        None
                    };
                let core_tick_group_range_upper_bound =
                    if core_tick_group_range_upper_bound_tick_index < MAX_TICK_INDEX {
                        Some((
                            core_tick_group_range_upper_index,
                            sqrt_price_from_tick_index(
                                core_tick_group_range_upper_bound_tick_index,
                            ),
                        ))
                    } else {
                        None
                    };

                // update volatility_accumulator at the initialization of the fee rate manager
                // Note: reduction uses the value of volatility_accumulator, but update_reference does not update it
                //       update_volatility_accumulator is always called if the swap loop is executed at least once,
                //       but it is executed as a precaution against the case where the swap loop does not run at all (sqrt_price_limit = whirlpool.sqrt_price)
                adaptive_fee_variables
                    .update_volatility_accumulator(tick_group_index, &adaptive_fee_constants)?;

                Ok(Self::Adaptive {
                    a_to_b,
                    tick_group_index,
                    static_fee_rate,
                    adaptive_fee_constants,
                    adaptive_fee_variables,
                    core_tick_group_range_lower_bound,
                    core_tick_group_range_upper_bound,
                })
            }
        }
    }

    pub fn update_volatility_accumulator(&mut self) -> Result<()> {
        match self {
            Self::Static { .. } => Ok(()),
            Self::Adaptive {
                tick_group_index,
                adaptive_fee_constants,
                adaptive_fee_variables,
                ..
            } => adaptive_fee_variables
                .update_volatility_accumulator(*tick_group_index, adaptive_fee_constants),
        }
    }

    pub fn update_major_swap_timestamp(
        &mut self,
        timestamp: u64,
        pre_sqrt_price: u128,
        post_sqrt_price: u128,
    ) -> Result<()> {
        match self {
            Self::Static { .. } => Ok(()),
            Self::Adaptive {
                adaptive_fee_variables,
                adaptive_fee_constants,
                ..
            } => adaptive_fee_variables.update_major_swap_timestamp(
                pre_sqrt_price,
                post_sqrt_price,
                timestamp,
                adaptive_fee_constants,
            ),
        }
    }

    // This function is called when skip is NOT used.
    pub fn advance_tick_group(&mut self) {
        match self {
            Self::Static { .. } => {
                // do nothing
            }
            Self::Adaptive {
                a_to_b,
                tick_group_index,
                ..
            } => {
                *tick_group_index += if *a_to_b { -1 } else { 1 };
            }
        }
    }

    // This function is called when skip is used.
    pub fn advance_tick_group_after_skip(
        &mut self,
        sqrt_price: u128,
        next_tick_sqrt_price: u128,
        next_tick_index: i32,
    ) -> Result<()> {
        match self {
            Self::Static { .. } => {
                // static fee rate manager doesn't use skip feature
                unreachable!();
            }
            Self::Adaptive {
                a_to_b,
                tick_group_index,
                adaptive_fee_variables,
                adaptive_fee_constants,
                ..
            } => {
                if sqrt_price == next_tick_sqrt_price {
                    // next_tick_index = tick_index_from_sqrt_price(&sqrt_price) is true,
                    // but we use next_tick_index to reduce calculations in the middle of the loop
                    *tick_group_index = floor_division(
                        next_tick_index,
                        adaptive_fee_constants.tick_group_size as i32,
                    );
                } else {
                    // End of the swap loop or the boundary of core tick group range.

                    // Note: It was pointed out during the review that using curr_tick_index may suppress tick_index_from_sqrt_price.
                    //       However, since curr_tick_index may also be shifted by -1, we decided to prioritize safety by recalculating it here.
                    *tick_group_index = floor_division(
                        tick_index_from_sqrt_price(&sqrt_price),
                        adaptive_fee_constants.tick_group_size as i32,
                    );
                }

                // volatility_accumulator is updated with the new tick_group_index based on new sqrt_price
                adaptive_fee_variables
                    .update_volatility_accumulator(*tick_group_index, adaptive_fee_constants)?;

                // If the swap direction is A to B, the tick group index should be decremented to "advance".
                // If sqrt_price is not on the tick_group_size boundary, tick_group_index will advance by one more.
                // However, it does not affect subsequent processing because it is the last iteration of the swap loop.
                if *a_to_b {
                    *tick_group_index -= 1;
                }

                Ok(())
            }
        }
    }

    pub fn get_total_fee_rate(&self) -> u32 {
        match self {
            Self::Static { static_fee_rate } => *static_fee_rate as u32,
            Self::Adaptive {
                static_fee_rate,
                adaptive_fee_constants,
                adaptive_fee_variables,
                ..
            } => {
                let adaptive_fee_rate =
                    Self::compute_adaptive_fee_rate(adaptive_fee_constants, adaptive_fee_variables);
                let total_fee_rate = *static_fee_rate as u32 + adaptive_fee_rate;

                if total_fee_rate > FEE_RATE_HARD_LIMIT {
                    FEE_RATE_HARD_LIMIT
                } else {
                    total_fee_rate
                }
            }
        }
    }

    // returns (bounded_sqrt_price, skip)
    // skip is true if the step-by-step calculation of adaptive fee is meaningless.
    //
    // When skip is true, we need to call advance_tick_group_after_skip() instead of advance_tick_group().
    pub fn get_bounded_sqrt_price_target(
        &self,
        sqrt_price: u128,
        curr_liquidity: u128,
    ) -> (u128, bool) {
        match self {
            Self::Static { .. } => (sqrt_price, false),
            Self::Adaptive {
                a_to_b,
                tick_group_index,
                adaptive_fee_constants,
                core_tick_group_range_lower_bound,
                core_tick_group_range_upper_bound,
                ..
            } => {
                // If the adaptive fee control factor is 0, the adaptive fee is not applied,
                // and the step-by-step calculation of adaptive fee is meaningless.
                if adaptive_fee_constants.adaptive_fee_control_factor == 0 {
                    return (sqrt_price, true);
                }

                // If the liquidity is 0, obviously no trades occur,
                // and the step-by-step calculation of adaptive fee is meaningless.
                if curr_liquidity == 0 {
                    return (sqrt_price, true);
                }

                // If the tick group index is out of the core tick group range (lower side),
                // the range where volatility_accumulator is always max_volatility_accumulator can be skipped.
                if let Some((lower_tick_group_index, lower_tick_group_bound_sqrt_price)) =
                    core_tick_group_range_lower_bound
                {
                    if *tick_group_index < *lower_tick_group_index {
                        if *a_to_b {
                            // <<-- swap direction -- <current tick group index> | core range |
                            return (sqrt_price, true);
                        } else {
                            // <current tick group index> -- swap direction -->> | core range |
                            return (sqrt_price.min(*lower_tick_group_bound_sqrt_price), true);
                        }
                    }
                }

                // If the tick group index is out of the core tick group range (upper side)
                // the range where volatility_accumulator is always max_volatility_accumulator can be skipped.
                if let Some((upper_tick_group_index, upper_tick_group_bound_sqrt_price)) =
                    core_tick_group_range_upper_bound
                {
                    if *tick_group_index > *upper_tick_group_index {
                        if *a_to_b {
                            // | core range | <<-- swap direction -- <current tick group index>
                            return (sqrt_price.max(*upper_tick_group_bound_sqrt_price), true);
                        } else {
                            // | core range | <current tick group index> -- swap direction -->>
                            return (sqrt_price, true);
                        }
                    }
                }

                let boundary_tick_index = if *a_to_b {
                    *tick_group_index * adaptive_fee_constants.tick_group_size as i32
                } else {
                    *tick_group_index * adaptive_fee_constants.tick_group_size as i32
                        + adaptive_fee_constants.tick_group_size as i32
                };

                let boundary_sqrt_price = sqrt_price_from_tick_index(
                    boundary_tick_index.clamp(MIN_TICK_INDEX, MAX_TICK_INDEX),
                );

                if *a_to_b {
                    (sqrt_price.max(boundary_sqrt_price), false)
                } else {
                    (sqrt_price.min(boundary_sqrt_price), false)
                }
            }
        }
    }

    pub fn get_next_adaptive_fee_info(&self) -> Option<AdaptiveFeeInfo> {
        match self {
            Self::Static { .. } => None,
            Self::Adaptive {
                adaptive_fee_constants,
                adaptive_fee_variables,
                ..
            } => Some(AdaptiveFeeInfo {
                constants: *adaptive_fee_constants,
                variables: *adaptive_fee_variables,
            }),
        }
    }

    fn compute_adaptive_fee_rate(
        adaptive_fee_constants: &AdaptiveFeeConstants,
        adaptive_fee_variables: &AdaptiveFeeVariables,
    ) -> u32 {
        let crossed = adaptive_fee_variables.volatility_accumulator
            * adaptive_fee_constants.tick_group_size as u32;

        let squared = u64::from(crossed) * u64::from(crossed);

        let fee_rate = ceil_division(
            u128::from(adaptive_fee_constants.adaptive_fee_control_factor) * u128::from(squared),
            u128::from(ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR)
                * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR)
                * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR),
        );

        if fee_rate > FEE_RATE_HARD_LIMIT as u128 {
            FEE_RATE_HARD_LIMIT
        } else {
            fee_rate as u32
        }
    }
}

#[cfg(test)]
mod static_fee_rate_manager_tests {
    use super::*;

    #[test]
    fn test_new() {
        let static_fee_rate = 3000;
        let fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        match fee_rate_manager {
            FeeRateManager::Static {
                static_fee_rate: rate,
            } => {
                assert_eq!(rate, static_fee_rate);
            }
            _ => panic!("Static variant expected."),
        }
    }

    #[test]
    fn test_update_volatility_accumulator() {
        let static_fee_rate = 3000;
        let mut fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        let result = fee_rate_manager.update_volatility_accumulator();
        assert_eq!(result, Ok(()));

        // not changed anything
        match fee_rate_manager {
            FeeRateManager::Static {
                static_fee_rate: rate,
            } => {
                assert_eq!(rate, static_fee_rate);
            }
            _ => panic!("Static variant expected."),
        }
    }

    #[test]
    fn test_advance_tick_group() {
        let static_fee_rate = 3000;
        let mut fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        fee_rate_manager.advance_tick_group();

        // not changed anything
        match fee_rate_manager {
            FeeRateManager::Static {
                static_fee_rate: rate,
            } => {
                assert_eq!(rate, static_fee_rate);
            }
            _ => panic!("Static variant expected."),
        }
    }

    #[test]
    #[should_panic]
    fn test_advance_tick_group_after_skip() {
        let static_fee_rate = 3000;
        let mut fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        // panic because static fee rate manager doesn't use skip feature
        let _ = fee_rate_manager.advance_tick_group_after_skip(
            sqrt_price_from_tick_index(1),
            sqrt_price_from_tick_index(64),
            64,
        );
    }

    #[test]
    fn test_get_total_fee_rate() {
        let static_fee_rate = 3000;
        let fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        // total fee = static fee (no adaptive fee)
        let total_fee_rate = fee_rate_manager.get_total_fee_rate();
        assert_eq!(total_fee_rate, static_fee_rate as u32);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target() {
        let static_fee_rate = 3000;
        let fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        fn check_not_bounded(fee_rate_manager: &FeeRateManager, sqrt_price: u128) {
            let non_zero_liquidity = 1_000_000_000u128;
            let (bounded_sqrt_price, skip) =
                fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
            assert_eq!(bounded_sqrt_price, sqrt_price);
            assert!(!skip); // skip should be always false for StaticFeeRateManager
        }

        check_not_bounded(
            &fee_rate_manager,
            sqrt_price_from_tick_index(MIN_TICK_INDEX),
        );
        check_not_bounded(
            &fee_rate_manager,
            sqrt_price_from_tick_index(MIN_TICK_INDEX / 2),
        );
        check_not_bounded(&fee_rate_manager, sqrt_price_from_tick_index(0));
        check_not_bounded(
            &fee_rate_manager,
            sqrt_price_from_tick_index(MAX_TICK_INDEX / 2),
        );
        check_not_bounded(
            &fee_rate_manager,
            sqrt_price_from_tick_index(MAX_TICK_INDEX),
        );
    }

    #[test]
    fn test_get_next_adaptive_fee_info() {
        let static_fee_rate = 3000;
        let fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        let next_adaptive_fee_info = fee_rate_manager.get_next_adaptive_fee_info();
        assert!(next_adaptive_fee_info.is_none());
    }

    #[test]
    fn test_update_major_swap_timestamp() {
        let static_fee_rate = 3000;
        let mut fee_rate_manager = FeeRateManager::new(false, 0, 0, static_fee_rate, None).unwrap();

        let pre_sqrt_price = sqrt_price_from_tick_index(0);
        let post_sqrt_price = sqrt_price_from_tick_index(1024);
        fee_rate_manager
            .update_major_swap_timestamp(0, pre_sqrt_price, post_sqrt_price)
            .unwrap();

        // not changed anything
        match fee_rate_manager {
            FeeRateManager::Static {
                static_fee_rate: rate,
            } => {
                assert_eq!(rate, static_fee_rate);
            }
            _ => panic!("Static variant expected."),
        }
    }
}

#[cfg(test)]
mod adaptive_fee_rate_manager_tests {
    use super::*;
    use crate::{
        math::{MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64},
        state::{AdaptiveFeeConstants, AdaptiveFeeInfo, AdaptiveFeeVariables},
    };

    fn adaptive_fee_info() -> AdaptiveFeeInfo {
        AdaptiveFeeInfo {
            constants: AdaptiveFeeConstants {
                filter_period: 30,
                decay_period: 600,
                max_volatility_accumulator: 350_000,
                reduction_factor: 500,
                adaptive_fee_control_factor: 100,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                ..Default::default()
            },
            variables: AdaptiveFeeVariables {
                last_reference_update_timestamp: 1738863309,
                last_major_swap_timestamp: 1738863309,
                tick_group_index_reference: 1,
                volatility_reference: 500,
                volatility_accumulator: 10000,
                ..Default::default()
            },
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn check_constants(
        adaptive_fee_constants: &AdaptiveFeeConstants,
        filter_period: u16,
        decay_period: u16,
        max_volatility_accumulator: u32,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        tick_group_size: u16,
        major_swap_threshold_ticks: u16,
    ) {
        assert!(adaptive_fee_constants.filter_period == filter_period);
        assert!(adaptive_fee_constants.decay_period == decay_period);
        assert!(adaptive_fee_constants.max_volatility_accumulator == max_volatility_accumulator);
        assert!(adaptive_fee_constants.reduction_factor == reduction_factor);
        assert!(adaptive_fee_constants.adaptive_fee_control_factor == adaptive_fee_control_factor);
        assert!(adaptive_fee_constants.tick_group_size == tick_group_size);
        assert!(adaptive_fee_constants.major_swap_threshold_ticks == major_swap_threshold_ticks);
    }

    fn check_variables(
        adaptive_fee_variables: &AdaptiveFeeVariables,
        last_reference_update_timestamp: u64,
        last_major_swap_timestamp: u64,
        tick_group_index_reference: i32,
        volatility_reference: u32,
        volatility_accumulator: u32,
    ) {
        assert!(
            adaptive_fee_variables.last_reference_update_timestamp
                == last_reference_update_timestamp
        );
        assert!(adaptive_fee_variables.last_major_swap_timestamp == last_major_swap_timestamp);
        assert!(adaptive_fee_variables.tick_group_index_reference == tick_group_index_reference);
        assert!(adaptive_fee_variables.volatility_reference == volatility_reference);
        assert!(adaptive_fee_variables.volatility_accumulator == volatility_accumulator);
    }

    fn check_tick_group_index_and_variables(
        fee_rate_manager: &FeeRateManager,
        tick_group_index: i32,
        last_reference_update_timestamp: u64,
        last_major_swap_timestamp: u64,
        tick_group_index_reference: i32,
        volatility_reference: u32,
        volatility_accumulator: u32,
    ) {
        match fee_rate_manager {
            FeeRateManager::Adaptive {
                tick_group_index: tgi,
                adaptive_fee_variables,
                ..
            } => {
                assert_eq!(*tgi, tick_group_index);
                check_variables(
                    adaptive_fee_variables,
                    last_reference_update_timestamp,
                    last_major_swap_timestamp,
                    tick_group_index_reference,
                    volatility_reference,
                    volatility_accumulator,
                );
            }
            _ => panic!("Adaptive variant expected."),
        }
    }

    #[test]
    fn test_new() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let tick_group_size = adaptive_fee_info.constants.tick_group_size;

        // < filter_period

        let current_tick_index = 1024;
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + 1;
        let fee_rate_manager = FeeRateManager::new(
            true,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();
        match fee_rate_manager {
            FeeRateManager::Adaptive {
                a_to_b,
                tick_group_index,
                static_fee_rate: rate,
                adaptive_fee_constants,
                adaptive_fee_variables,
                core_tick_group_range_lower_bound,
                core_tick_group_range_upper_bound,
            } => {
                assert!(a_to_b);
                assert_eq!(tick_group_index, 16);
                assert_eq!(rate, static_fee_rate);

                // max_volatility_delta = ceil(  (max_volatility_accumulator - volatility_reference) / VOLATILITY_ACCUMULATOR_SCALE_FACTOR )
                // = ceil( (350_000 - 500) / 10_000 ) = 35
                // tick_group_index_reference +/- max_volatility_delta
                // = 1 +/- 35 = -34, 36
                assert_eq!(
                    core_tick_group_range_lower_bound,
                    Some((
                        -34,
                        sqrt_price_from_tick_index(-34 * tick_group_size as i32)
                    ))
                );
                assert_eq!(
                    core_tick_group_range_upper_bound,
                    Some((
                        36,
                        sqrt_price_from_tick_index(
                            36 * tick_group_size as i32 + tick_group_size as i32
                        )
                    ))
                );

                check_constants(
                    &adaptive_fee_constants,
                    adaptive_fee_info.constants.filter_period,
                    adaptive_fee_info.constants.decay_period,
                    adaptive_fee_info.constants.max_volatility_accumulator,
                    adaptive_fee_info.constants.reduction_factor,
                    adaptive_fee_info.constants.adaptive_fee_control_factor,
                    adaptive_fee_info.constants.tick_group_size,
                    adaptive_fee_info.constants.major_swap_threshold_ticks,
                );
                // update_reference and update_volatility_accumulator should be called
                let expected_volatility_accumulator = (adaptive_fee_info
                    .variables
                    .volatility_reference
                    + ((floor_division(current_tick_index, tick_group_size as i32)
                        - adaptive_fee_info.variables.tick_group_index_reference)
                        .abs()
                        * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as i32) as u32)
                    .min(adaptive_fee_info.constants.max_volatility_accumulator);
                check_variables(
                    &adaptive_fee_variables,
                    // both reference and timestamp should not be updated (< filter_period)
                    adaptive_fee_info.variables.last_reference_update_timestamp,
                    adaptive_fee_info.variables.last_major_swap_timestamp,
                    adaptive_fee_info.variables.tick_group_index_reference,
                    adaptive_fee_info.variables.volatility_reference,
                    // volatility_accumulator should be updated
                    expected_volatility_accumulator,
                );
            }
            _ => panic!("Adaptive variant expected."),
        }

        // >= filter_period, < decay_period

        let current_tick_index = 1024;
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.filter_period as u64;
        let fee_rate_manager = FeeRateManager::new(
            false,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();
        match fee_rate_manager {
            FeeRateManager::Adaptive {
                a_to_b,
                tick_group_index,
                static_fee_rate: rate,
                adaptive_fee_constants,
                adaptive_fee_variables,
                core_tick_group_range_lower_bound,
                core_tick_group_range_upper_bound,
            } => {
                assert!(!a_to_b);
                assert_eq!(tick_group_index, 16);
                assert_eq!(rate, static_fee_rate);

                // tick_group_index_reference should be updated
                // tick_group_index_reference +/- max_volatility_delta
                // = 16 +/- 35 = -19, 51
                assert_eq!(
                    core_tick_group_range_lower_bound,
                    Some((
                        -19,
                        sqrt_price_from_tick_index(-19 * tick_group_size as i32)
                    ))
                );
                assert_eq!(
                    core_tick_group_range_upper_bound,
                    Some((
                        51,
                        sqrt_price_from_tick_index(
                            51 * tick_group_size as i32 + tick_group_size as i32
                        )
                    ))
                );

                check_constants(
                    &adaptive_fee_constants,
                    adaptive_fee_info.constants.filter_period,
                    adaptive_fee_info.constants.decay_period,
                    adaptive_fee_info.constants.max_volatility_accumulator,
                    adaptive_fee_info.constants.reduction_factor,
                    adaptive_fee_info.constants.adaptive_fee_control_factor,
                    adaptive_fee_info.constants.tick_group_size,
                    adaptive_fee_info.constants.major_swap_threshold_ticks,
                );
                // update_reference and update_volatility_accumulator should be called
                let expected_tick_group_index_reference = 16;
                let expected_volatility_reference =
                    adaptive_fee_info.variables.volatility_accumulator
                        * adaptive_fee_info.constants.reduction_factor as u32
                        / REDUCTION_FACTOR_DENOMINATOR as u32;
                let expected_volatility_accumulator = expected_volatility_reference; // delta = 0
                check_variables(
                    &adaptive_fee_variables,
                    timestamp, // should be updated
                    adaptive_fee_info.variables.last_major_swap_timestamp,
                    // both reference should be updated (>= filter_period, < decay_period)
                    expected_tick_group_index_reference,
                    expected_volatility_reference,
                    // volatility_accumulator should be updated
                    expected_volatility_accumulator,
                );
            }
            _ => panic!("Adaptive variant expected."),
        }

        // >= decay_period

        let current_tick_index = 1024;
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let fee_rate_manager = FeeRateManager::new(
            false,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();
        match fee_rate_manager {
            FeeRateManager::Adaptive {
                a_to_b,
                tick_group_index,
                static_fee_rate: rate,
                adaptive_fee_constants,
                adaptive_fee_variables,
                core_tick_group_range_lower_bound,
                core_tick_group_range_upper_bound,
            } => {
                assert!(!a_to_b);
                assert_eq!(tick_group_index, 16);
                assert_eq!(rate, static_fee_rate);

                // tick_group_index_reference should be updated
                // tick_group_index_reference +/- max_volatility_delta
                // = 16 +/- 35 = -19, 51
                assert_eq!(
                    core_tick_group_range_lower_bound,
                    Some((
                        -19,
                        sqrt_price_from_tick_index(-19 * tick_group_size as i32)
                    ))
                );
                assert_eq!(
                    core_tick_group_range_upper_bound,
                    Some((
                        51,
                        sqrt_price_from_tick_index(
                            51 * tick_group_size as i32 + tick_group_size as i32
                        )
                    ))
                );

                check_constants(
                    &adaptive_fee_constants,
                    adaptive_fee_info.constants.filter_period,
                    adaptive_fee_info.constants.decay_period,
                    adaptive_fee_info.constants.max_volatility_accumulator,
                    adaptive_fee_info.constants.reduction_factor,
                    adaptive_fee_info.constants.adaptive_fee_control_factor,
                    adaptive_fee_info.constants.tick_group_size,
                    adaptive_fee_info.constants.major_swap_threshold_ticks,
                );
                // update_reference and update_volatility_accumulator should be called
                let expected_tick_group_index_reference = 16;
                let expected_volatility_reference = 0;
                let expected_volatility_accumulator = 0;
                check_variables(
                    &adaptive_fee_variables,
                    timestamp, // should be updated
                    adaptive_fee_info.variables.last_major_swap_timestamp,
                    // both reference should be updated (>= decay_period)
                    expected_tick_group_index_reference,
                    expected_volatility_reference,
                    // volatility_reference should be updated
                    expected_volatility_accumulator,
                );
            }
            _ => panic!("Adaptive variant expected."),
        }
    }

    mod test_new_core_tick_group_range {
        use super::*;

        fn test(
            tick_group_size: u16,
            tick_group_reference: i32,
            volatility_refereence: u32,
            max_volatility_accumulator: u32,
            expected_lower_tick_group_index: Option<i32>,
            expected_upper_tick_group_index: Option<i32>,
        ) {
            let a_to_b = true;
            let current_tick_index = 0;
            let timestamp = 1000;
            let static_fee_rate = 3000;

            let fee_rate_manager = FeeRateManager::new(
                a_to_b,
                current_tick_index,
                timestamp,
                static_fee_rate,
                Some(AdaptiveFeeInfo {
                    constants: AdaptiveFeeConstants {
                        filter_period: 30,
                        decay_period: 600,
                        max_volatility_accumulator,
                        reduction_factor: 500,
                        adaptive_fee_control_factor: 100,
                        tick_group_size,
                        major_swap_threshold_ticks: tick_group_size,
                        ..Default::default()
                    },
                    variables: AdaptiveFeeVariables {
                        last_reference_update_timestamp: timestamp,
                        last_major_swap_timestamp: timestamp,
                        tick_group_index_reference: tick_group_reference,
                        volatility_reference: volatility_refereence,
                        volatility_accumulator: 0,
                        ..Default::default()
                    },
                }),
            )
            .unwrap();

            let expected_core_tick_group_range_lower_bound =
                expected_lower_tick_group_index.map(|index| {
                    (
                        index,
                        sqrt_price_from_tick_index(index * tick_group_size as i32),
                    )
                });
            let expected_core_tick_group_range_upper_bound =
                expected_upper_tick_group_index.map(|index| {
                    (
                        index,
                        sqrt_price_from_tick_index(
                            index * tick_group_size as i32 + tick_group_size as i32,
                        ),
                    )
                });

            match fee_rate_manager {
                FeeRateManager::Adaptive {
                    core_tick_group_range_lower_bound,
                    core_tick_group_range_upper_bound,
                    ..
                } => {
                    assert_eq!(
                        core_tick_group_range_lower_bound,
                        expected_core_tick_group_range_lower_bound
                    );
                    assert_eq!(
                        core_tick_group_range_upper_bound,
                        expected_core_tick_group_range_upper_bound
                    );
                }
                _ => panic!("Adaptive variant expected."),
            }
        }

        // max_volatility_delta = ceil(  (max_volatility_accumulator - volatility_reference) / VOLATILITY_ACCUMULATOR_SCALE_FACTOR )
        // tick_group_index_reference +/- max_volatility_delta

        #[test]
        fn test_ts_64() {
            test(64, 0, 0, 350_000, Some(-35), Some(35));
            test(64, 0, 0, 100_000, Some(-10), Some(10));

            // shift by tick_group_reference
            test(64, 100, 0, 350_000, Some(65), Some(135));

            // volatility_reference should be used
            test(64, 100, 100_000, 350_000, Some(75), Some(125));

            // ceil should be used
            test(64, 100, 100_000, 350_001, Some(74), Some(126));
            test(64, 100, 100_000, 359_999, Some(74), Some(126));
            test(64, 100, 100_000, 360_000, Some(74), Some(126));
            test(64, 100, 100_000, 360_001, Some(73), Some(127));

            test(64, 100, 100_001, 350_000, Some(75), Some(125));
            test(64, 100, 109_999, 350_000, Some(75), Some(125));
            test(64, 100, 110_000, 350_000, Some(76), Some(124));
            test(64, 100, 110_001, 350_000, Some(76), Some(124));
            test(64, 100, 119_999, 350_000, Some(76), Some(124));

            // None if the left edge of lower bound is out of the tick range
            test(64, -6896, 0, 350_000, Some(-6896 - 35), Some(-6896 + 35));
            test(64, -6897, 0, 350_000, None, Some(-6897 + 35));
            test(64, -6931, 0, 350_000, None, Some(-6931 + 35));
            test(64, -6932, 0, 350_000, None, Some(-6932 + 35));

            // None if the right edge of upper bound is out of the tick range
            test(64, 6895, 0, 350_000, Some(6895 - 35), Some(6895 + 35));
            test(64, 6896, 0, 350_000, Some(6896 - 35), None);
            test(64, 6930, 0, 350_000, Some(6930 - 35), None);
            test(64, 6931, 0, 350_000, Some(6931 - 35), None);

            // high volatility reference
            test(64, 0, 340_000, 350_000, Some(-1), Some(1));
            test(64, 0, 349_999, 350_000, Some(-1), Some(1));

            // zero max volatility accumulator (edge case: should set adaptive fee factor to 0 if adaptive fee is not used)
            test(64, 0, 0, 0, Some(0), Some(0));
            test(64, 100, 0, 0, Some(100), Some(100));
            test(64, -6931, 0, 0, Some(-6931), Some(-6931));
            test(64, -6932, 0, 0, None, Some(-6932));
            test(64, 6930, 0, 0, Some(6930), Some(6930));
            test(64, 6931, 0, 0, Some(6931), None);
        }

        #[test]
        fn test_ts_1() {
            test(1, 0, 0, 350_000, Some(-35), Some(35));
            test(1, 0, 0, 100_000, Some(-10), Some(10));

            // shift by tick_group_reference
            test(1, 100, 0, 350_000, Some(65), Some(135));

            // None if the left edge of lower bound is out of the tick range
            // note: MIN_TICK_INDEX will not be the left edge of lower bound
            test(
                1,
                -443600,
                0,
                350_000,
                Some(-443600 - 35),
                Some(-443600 + 35),
            );
            test(1, -443601, 0, 350_000, None, Some(-443601 + 35));
            test(1, -443602, 0, 350_000, None, Some(-443602 + 35));
            test(1, -443635, 0, 350_000, None, Some(-443635 + 35));
            test(1, -443636, 0, 350_000, None, Some(-443636 + 35));
            test(1, -443637, 0, 350_000, None, Some(-443637 + 35));

            // None if the right edge of upper bound is out of the tick range
            // note: MAX_TICK_INDEX will not be the right edge of upper bound
            test(1, 443599, 0, 350_000, Some(443599 - 35), Some(443599 + 35));
            test(1, 443600, 0, 350_000, Some(443600 - 35), None);
            test(1, 443601, 0, 350_000, Some(443601 - 35), None);
            test(1, 443635, 0, 350_000, Some(443635 - 35), None);
            test(1, 443636, 0, 350_000, Some(443636 - 35), None);

            // zero max volatility accumulator (edge case: should set adaptive fee factor to 0 if adaptive fee is not used)
            test(1, 0, 0, 0, Some(0), Some(0));
            test(1, 100, 0, 0, Some(100), Some(100));
            test(1, -443635, 0, 0, Some(-443635), Some(-443635));
            test(1, -443636, 0, 0, None, Some(-443636));
            test(1, 443634, 0, 0, Some(443634), Some(443634));
            test(1, 443635, 0, 0, Some(443635), None);
        }
    }

    #[test]
    fn test_update_volatility_accumulator_and_advance_tick_group_b_to_a() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 1024;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            false,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // delta = 0
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            16,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            16,
            0,
            0,
        );

        // delta = 1
        fee_rate_manager.advance_tick_group(); // 16 to 17 (b to a)
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            17,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            16,
            0,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
        );

        // delta = 2
        fee_rate_manager.advance_tick_group(); // 17 to 18 (b to a)
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            18,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            16,
            0,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
        );
    }

    #[test]
    fn test_update_volatility_accumulator_and_advance_tick_group_a_to_b() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 64;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            true,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // delta = 0
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            1,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            1,
            0,
            0,
        );

        // delta = 1
        fee_rate_manager.advance_tick_group(); // 1 to 0 (a to b)
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            0,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            1,
            0,
            VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
        );

        // delta = 2
        fee_rate_manager.advance_tick_group(); // 0 to -1 (a to b)
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            -1,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            1,
            0,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
        );
    }

    mod test_compute_adaptive_fee_rate {
        use super::*;

        fn test(constants: AdaptiveFeeConstants, pre_calculated_fee_rates: &[u32]) {
            let mut variables = AdaptiveFeeVariables::default();
            let timestamp = 1738863309;
            let base_tick_group_index = 16;

            variables
                .update_reference(base_tick_group_index, timestamp, &constants)
                .unwrap();
            for (delta, pre_calculated_fee_rate) in pre_calculated_fee_rates.iter().enumerate() {
                let tick_group_index = base_tick_group_index + delta as i32;

                variables
                    .update_volatility_accumulator(tick_group_index, &constants)
                    .unwrap();

                let fee_rate = FeeRateManager::compute_adaptive_fee_rate(&constants, &variables);

                let volatility_accumulator =
                    delta as u32 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                let capped_volatility_accumulator =
                    volatility_accumulator.min(constants.max_volatility_accumulator);

                let crossed_tick_indexes =
                    capped_volatility_accumulator * constants.tick_group_size as u32;
                let squared_crossed_tick_indexes =
                    u64::from(crossed_tick_indexes) * u64::from(crossed_tick_indexes);

                let expected_fee_rate = ceil_division(
                    u128::from(constants.adaptive_fee_control_factor)
                        * u128::from(squared_crossed_tick_indexes),
                    u128::from(ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR)
                        * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR)
                        * u128::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR),
                ) as u32;
                let capped_expected_fee_rate = expected_fee_rate.min(FEE_RATE_HARD_LIMIT);

                assert_eq!(fee_rate, capped_expected_fee_rate);
                assert_eq!(fee_rate, *pre_calculated_fee_rate);
            }
        }

        #[test]
        fn test_max_volatility_accumulator_should_bound_fee_rate() {
            test(
                AdaptiveFeeConstants {
                    max_volatility_accumulator: 350_000,
                    adaptive_fee_control_factor: 1500,
                    tick_group_size: 64,
                    major_swap_threshold_ticks: 64,
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
                    ..Default::default()
                },
                /*
                  # Google Colaboratory

                  ADAPTIVE_FEE_CONTROL_FACTOR_DENOM = 100_000
                  VOLATILITY_ACCUMULATOR_SCALE_FACTOR = 10_000
                  FEE_RATE_HARD_LIMIT = 100_000

                  adaptive_fee_control_factor = 1500
                  tick_group_size = 64
                  max_volatility_accumulator = 35 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR

                  for delta in range(0, 50):
                    volatility_accumulator = delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                    capped_volatility_accumulator = min(max_volatility_accumulator, volatility_accumulator)

                    crossed = capped_volatility_accumulator * tick_group_size
                    squred = crossed * crossed

                    denom = ADAPTIVE_FEE_CONTROL_FACTOR_DENOM * VOLATILITY_ACCUMULATOR_SCALE_FACTOR * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                    fee_rate = (adaptive_fee_control_factor * squred + (denom - 1)) // denom # ceil
                    capped_fee_rate = min(fee_rate, FEE_RATE_HARD_LIMIT)

                    print("{},".format(capped_fee_rate))
                */
                &[
                    0, 62, 246, 553, 984, 1536, 2212, 3011, 3933, 4977, 6144, 7435, 8848, 10384,
                    12043, 13824, 15729, 17757, 19907, 22180, 24576, 27096, 29737, 32502, 35390,
                    38400, 41534, 44790, 48169, 51672, 55296, 59044, 62915, 66909, 71025, 75264,
                    75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264, 75264,
                    75264, 75264, 75264,
                ],
            );
        }

        #[test]
        fn test_fee_rate_hard_limit_should_bound_fee_rate() {
            test(
                AdaptiveFeeConstants {
                    max_volatility_accumulator: 450_000,
                    adaptive_fee_control_factor: 1500,
                    tick_group_size: 64,
                    major_swap_threshold_ticks: 64,
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
                    ..Default::default()
                },
                /*
                  # Google Colaboratory

                  ADAPTIVE_FEE_CONTROL_FACTOR_DENOM = 100_000
                  VOLATILITY_ACCUMULATOR_SCALE_FACTOR = 10_000
                  FEE_RATE_HARD_LIMIT = 100_000

                  adaptive_fee_control_factor = 1500
                  tick_group_size = 64
                  max_volatility_accumulator = 45 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR

                  for delta in range(0, 50):
                    volatility_accumulator = delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                    capped_volatility_accumulator = min(max_volatility_accumulator, volatility_accumulator)

                    crossed = capped_volatility_accumulator * tick_group_size
                    squred = crossed * crossed

                    denom = ADAPTIVE_FEE_CONTROL_FACTOR_DENOM * VOLATILITY_ACCUMULATOR_SCALE_FACTOR * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                    fee_rate = (adaptive_fee_control_factor * squred + (denom - 1)) // denom # ceil
                    capped_fee_rate = min(fee_rate, FEE_RATE_HARD_LIMIT)

                    print("{},".format(capped_fee_rate))
                */
                &[
                    0, 62, 246, 553, 984, 1536, 2212, 3011, 3933, 4977, 6144, 7435, 8848, 10384,
                    12043, 13824, 15729, 17757, 19907, 22180, 24576, 27096, 29737, 32502, 35390,
                    38400, 41534, 44790, 48169, 51672, 55296, 59044, 62915, 66909, 71025, 75264,
                    79627, 84112, 88720, 93451, 98304, 100000, 100000, 100000, 100000, 100000,
                    100000, 100000, 100000, 100000,
                ],
            );
        }

        #[test]
        fn test_fee_rate_is_not_bounded_in_this_range() {
            test(
                AdaptiveFeeConstants {
                    max_volatility_accumulator: 500_000,
                    adaptive_fee_control_factor: 1000,
                    tick_group_size: 64,
                    major_swap_threshold_ticks: 64,
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
                    ..Default::default()
                },
                /*
                  # Google Colaboratory

                  ADAPTIVE_FEE_CONTROL_FACTOR_DENOM = 100_000
                  VOLATILITY_ACCUMULATOR_SCALE_FACTOR = 10_000
                  FEE_RATE_HARD_LIMIT = 100_000

                  adaptive_fee_control_factor = 1000
                  tick_group_size = 64
                  max_volatility_accumulator = 50 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR

                  for delta in range(0, 50):
                    volatility_accumulator = delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                    capped_volatility_accumulator = min(max_volatility_accumulator, volatility_accumulator)

                    crossed = capped_volatility_accumulator * tick_group_size
                    squred = crossed * crossed

                    denom = ADAPTIVE_FEE_CONTROL_FACTOR_DENOM * VOLATILITY_ACCUMULATOR_SCALE_FACTOR * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
                    fee_rate = (adaptive_fee_control_factor * squred + (denom - 1)) // denom # ceil
                    capped_fee_rate = min(fee_rate, FEE_RATE_HARD_LIMIT)

                    print("{},".format(capped_fee_rate))
                */
                &[
                    0, 41, 164, 369, 656, 1024, 1475, 2008, 2622, 3318, 4096, 4957, 5899, 6923,
                    8029, 9216, 10486, 11838, 13272, 14787, 16384, 18064, 19825, 21668, 23593,
                    25600, 27689, 29860, 32113, 34448, 36864, 39363, 41944, 44606, 47350, 50176,
                    53085, 56075, 59147, 62301, 65536, 68854, 72254, 75736, 79299, 82944, 86672,
                    90481, 94372, 98345,
                ],
            );
        }
    }

    #[test]
    fn test_get_total_fee_rate() {
        let adaptive_fee_info = Some(AdaptiveFeeInfo {
            constants: AdaptiveFeeConstants {
                max_volatility_accumulator: 450_000,
                adaptive_fee_control_factor: 1500,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                ..Default::default()
            },
            variables: AdaptiveFeeVariables::default(),
        });

        let timestamp = 1738863309;
        let static_fee_rate = 10_000; // 1%

        let mut fee_rate_manager =
            FeeRateManager::new(true, 1024, timestamp, static_fee_rate, adaptive_fee_info).unwrap();

        /*
         # Google Colaboratory

         ADAPTIVE_FEE_CONTROL_FACTOR_DENOM = 100_000
         VOLATILITY_ACCUMULATOR_SCALE_FACTOR = 10_000
         FEE_RATE_HARD_LIMIT = 100_000

         adaptive_fee_control_factor = 1500
         tick_group_size = 64
         max_volatility_accumulator = 45 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
         static_fee_rate = 10_000 # 1%

         for delta in range(0, 50):
           volatility_accumulator = delta * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
           capped_volatility_accumulator = min(max_volatility_accumulator, volatility_accumulator)

           crossed = capped_volatility_accumulator * tick_group_size
           squred = crossed * crossed

           denom = ADAPTIVE_FEE_CONTROL_FACTOR_DENOM * VOLATILITY_ACCUMULATOR_SCALE_FACTOR * VOLATILITY_ACCUMULATOR_SCALE_FACTOR
           adaptive_fee_rate = (adaptive_fee_control_factor * squred + (denom - 1)) // denom # ceil
           capped_adaptive_fee_rate = min(adaptive_fee_rate, FEE_RATE_HARD_LIMIT)

           capped_fee_rate = min(static_fee_rate + capped_adaptive_fee_rate, FEE_RATE_HARD_LIMIT)

           print("{},".format(capped_fee_rate))
        */
        let pre_calculated_total_fee_rates = [
            10000, 10062, 10246, 10553, 10984, 11536, 12212, 13011, 13933, 14977, 16144, 17435,
            18848, 20384, 22043, 23824, 25729, 27757, 29907, 32180, 34576, 37096, 39737, 42502,
            45390, 48400, 51534, 54790, 58169, 61672, 65296, 69044, 72915, 76909, 81025, 85264,
            89627, 94112, 98720, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000,
            100000, 100000, 100000,
        ];

        for pre_calculated_total_fee_rate in pre_calculated_total_fee_rates.iter() {
            fee_rate_manager.update_volatility_accumulator().unwrap();

            let total_fee_rate = fee_rate_manager.get_total_fee_rate();
            assert_eq!(total_fee_rate, *pre_calculated_total_fee_rate);

            fee_rate_manager.advance_tick_group();
        }
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_a_to_b_without_skip() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();
        let non_zero_liquidity = 1_000_000_000u128;

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            true,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // a to b = right(positive) to left(negative)

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(!skip);

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(!skip);

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 - 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024));
        assert!(!skip);

        // sqrt_price is very far than the boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024));
        assert!(!skip);

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 - 64));
        assert!(!skip);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_a_to_b_with_zero_liquidity_skip() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();
        let zero_liquidity = 0u128;

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            true,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // a to b = right(positive) to left(negative)

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 + 16 should be used

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 should be used

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 - 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 - 16));
        assert!(skip);

        // sqrt_price is very far than the boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, MIN_SQRT_PRICE_X64);
        assert!(skip);

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, MIN_SQRT_PRICE_X64);
        assert!(skip);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_a_to_b_with_adaptive_fee_factor_skip() {
        let static_fee_rate = 3000;
        let mut adaptive_fee_info = adaptive_fee_info();
        let non_zero_liquidity = 1_000_000_000u128;

        // adaptive fee factor is zero
        adaptive_fee_info.constants.adaptive_fee_control_factor = 0;

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            true,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // a to b = right(positive) to left(negative)

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 + 16 should be used

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 should be used

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 - 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 - 16));
        assert!(skip);

        // sqrt_price is very far than the boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, MIN_SQRT_PRICE_X64);
        assert!(skip);

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, MIN_SQRT_PRICE_X64);
        assert!(skip);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_a_to_b_with_max_volatility_skip() {
        let static_fee_rate = 3000;
        let non_zero_liquidity = 1_000_000_000u128;

        let timestamp = 1_000;
        let a_to_b = true;

        let adaptive_fee_info = AdaptiveFeeInfo {
            constants: AdaptiveFeeConstants {
                max_volatility_accumulator: 80_000,
                adaptive_fee_control_factor: 1500,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                ..Default::default()
            },
            variables: AdaptiveFeeVariables {
                last_reference_update_timestamp: timestamp,
                last_major_swap_timestamp: timestamp,
                tick_group_index_reference: 0,
                volatility_accumulator: 0,
                volatility_reference: 0,
                ..Default::default()
            },
        };

        // a to b = right(positive) to left(negative)
        // core range [-8, 8]

        // right side of core range
        let current_tick_index = 2048;
        let fee_rate_manager = FeeRateManager::new(
            a_to_b,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // sqrt_price is near than the boundary (core range right end)
        let sqrt_price = sqrt_price_from_tick_index(1024);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 should be used

        // sqrt_price is far than the boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(8 * 64 + 64)); // core range right end
        assert!(skip);

        // in core range
        let current_tick_index = 64 * 8 + 32;
        let fee_rate_manager = FeeRateManager::new(
            a_to_b,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(64 * 8 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(!skip);

        // sqrt_price is far than the boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(64 * 8)); // should be bounded
        assert!(!skip);

        // left side of core range
        let current_tick_index = -2048;
        let fee_rate_manager = FeeRateManager::new(
            a_to_b,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // no boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, MIN_SQRT_PRICE_X64);
        assert!(skip);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_b_to_a_without_skip() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();
        let non_zero_liquidity = 1_000_000_000u128;

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            false,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // b to a = left(negative) to right(positive)

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 32 + 16);
        let bounded_sqrt_price = fee_rate_manager
            .get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity)
            .0;
        assert_eq!(bounded_sqrt_price, sqrt_price);

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64);
        let bounded_sqrt_price = fee_rate_manager
            .get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity)
            .0;
        assert_eq!(bounded_sqrt_price, sqrt_price);

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64 + 16);
        let bounded_sqrt_price = fee_rate_manager
            .get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity)
            .0;
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 + 64));

        // sqrt_price is very far than the boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let bounded_sqrt_price = fee_rate_manager
            .get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity)
            .0;
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 + 64));

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MAX_SQRT_PRICE_X64;
        let bounded_sqrt_price = fee_rate_manager
            .get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity)
            .0;
        assert_eq!(
            bounded_sqrt_price,
            sqrt_price_from_tick_index(1024 + 64 + 64)
        );
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_b_to_a_with_zero_liquidity_skip() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();
        let zero_liquidity = 0u128;

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            false,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // b to a = left(negative) to right(positive)

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 32 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 + 32 + 16 should be used

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 + 64 should be used

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(
            bounded_sqrt_price,
            sqrt_price_from_tick_index(1024 + 64 + 16)
        );
        assert!(skip);

        // sqrt_price is very far than the boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, MAX_SQRT_PRICE_X64);
        assert!(skip);

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, zero_liquidity);
        assert_eq!(bounded_sqrt_price, MAX_SQRT_PRICE_X64);
        assert!(skip);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_b_to_a_with_adaptive_fee_factor_skip() {
        let static_fee_rate = 3000;
        let mut adaptive_fee_info = adaptive_fee_info();
        let non_zero_liquidity = 1_000_000_000u128;

        // adaptive fee factor is zero
        adaptive_fee_info.constants.adaptive_fee_control_factor = 0;

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            false,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // b to a = left(negative) to right(positive)

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 32 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 + 32 + 16 should be used

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but 1024 + 64 should be used

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(
            bounded_sqrt_price,
            sqrt_price_from_tick_index(1024 + 64 + 16)
        );
        assert!(skip);

        // sqrt_price is very far than the boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, MAX_SQRT_PRICE_X64);
        assert!(skip);

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, MAX_SQRT_PRICE_X64);
        assert!(skip);
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_b_to_a_with_max_volatility_skip() {
        let static_fee_rate = 3000;
        let non_zero_liquidity = 1_000_000_000u128;

        let timestamp = 1_000;
        let a_to_b = false;

        let adaptive_fee_info = AdaptiveFeeInfo {
            constants: AdaptiveFeeConstants {
                max_volatility_accumulator: 80_000,
                adaptive_fee_control_factor: 1500,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                ..Default::default()
            },
            variables: AdaptiveFeeVariables {
                last_reference_update_timestamp: timestamp,
                last_major_swap_timestamp: timestamp,
                tick_group_index_reference: 0,
                volatility_accumulator: 0,
                volatility_reference: 0,
                ..Default::default()
            },
        };

        // b to a = left(negative) to right(positive)
        // core range [-8, 8]

        // right side of core range
        let current_tick_index = 2048;
        let fee_rate_manager = FeeRateManager::new(
            a_to_b,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // no boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, MAX_SQRT_PRICE_X64);
        assert!(skip);

        // in core range
        let current_tick_index = 64 * -8 + 32;
        let fee_rate_manager = FeeRateManager::new(
            a_to_b,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // sqrt_price is near than the boundary
        let sqrt_price = sqrt_price_from_tick_index(64 * -8 + 32 + 16);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(!skip);

        // sqrt_price is far than the boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(64 * -8 + 64)); // should be bounded
        assert!(!skip);

        // left side of core range
        let current_tick_index = -2048;
        let fee_rate_manager = FeeRateManager::new(
            a_to_b,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        // sqrt_price is near than the boundary (core range left end)
        let sqrt_price = sqrt_price_from_tick_index(-1024);
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price);
        assert!(skip); // skip, but -1024 should be used

        // sqrt_price is far than the boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let (bounded_sqrt_price, skip) =
            fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price, non_zero_liquidity);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(-8 * 64)); // core range left end
        assert!(skip);
    }

    mod advance_tick_group_after_skip {
        use super::*;

        fn build_fee_rate_manager(a_to_b: bool, current_tick_index: i32) -> FeeRateManager {
            let timestamp = 1_000;
            let static_fee_rate = 3_000;

            let adaptive_fee_info = AdaptiveFeeInfo {
                constants: AdaptiveFeeConstants {
                    max_volatility_accumulator: 64
                        * 88
                        * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
                    adaptive_fee_control_factor: 5_000,
                    tick_group_size: 64,
                    major_swap_threshold_ticks: 64,
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
                    ..Default::default()
                },
                variables: AdaptiveFeeVariables {
                    last_reference_update_timestamp: timestamp,
                    last_major_swap_timestamp: timestamp,
                    tick_group_index_reference: 0,
                    volatility_accumulator: 0,
                    volatility_reference: 0,
                    ..Default::default()
                },
            };

            FeeRateManager::new(
                a_to_b,
                current_tick_index,
                timestamp,
                static_fee_rate,
                Some(adaptive_fee_info.clone()),
            )
            .unwrap()
        }

        fn test(
            a_to_b: bool,
            current_tick_index: i32,
            advance_current_sqrt_price: u128,
            advance_next_tick_sqrt_price: u128,
            advance_next_tick_index: i32,
            expected_tick_group_index: i32,
            expected_volatility_accumulator: u32,
        ) {
            let mut fee_rate_manager = build_fee_rate_manager(a_to_b, current_tick_index);

            fee_rate_manager
                .advance_tick_group_after_skip(
                    advance_current_sqrt_price,
                    advance_next_tick_sqrt_price,
                    advance_next_tick_index,
                )
                .unwrap();

            match fee_rate_manager {
                FeeRateManager::Adaptive {
                    tick_group_index,
                    adaptive_fee_variables,
                    ..
                } => {
                    assert_eq!(tick_group_index, expected_tick_group_index);
                    assert!(
                        adaptive_fee_variables.volatility_accumulator
                            == expected_volatility_accumulator
                    );
                }
                _ => panic!("Some and Adaptive variant expected."),
            }
        }

        #[test]
        fn test_b_to_a() {
            // left to right
            let a_to_b = false;
            let tick_group_size = 64;
            let max_volatility_accumulator = 64 * 88 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;

            // hit next tick
            // -1024 --> tick(-1023)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-1023),
                sqrt_price_from_tick_index(-1023),
                -1023,
                -16,
                16 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(-65)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-65),
                sqrt_price_from_tick_index(-65),
                -65,
                -2,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(-64)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-64),
                sqrt_price_from_tick_index(-64),
                -64,
                -1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(-32)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-32),
                sqrt_price_from_tick_index(-32),
                -32,
                -1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(0)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(0),
                sqrt_price_from_tick_index(0),
                0,
                0,
                0,
            );
            // -1024 --> tick(32)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(32),
                sqrt_price_from_tick_index(32),
                32,
                0,
                0,
            );
            // -1024 --> tick(64)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(64),
                sqrt_price_from_tick_index(64),
                64,
                1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(65)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(65),
                sqrt_price_from_tick_index(65),
                65,
                1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(127)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(127),
                sqrt_price_from_tick_index(127),
                127,
                1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(128)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(128),
                sqrt_price_from_tick_index(128),
                128,
                2,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> MAX_SQRT_PRICE
            test(
                a_to_b,
                -1024,
                MAX_SQRT_PRICE_X64,
                MAX_SQRT_PRICE_X64,
                MAX_TICK_INDEX,
                MAX_TICK_INDEX / tick_group_size,
                max_volatility_accumulator,
            );

            // NOT hit next tick
            // -1024 --> tick(-1023)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-1023) - 1,
                sqrt_price_from_tick_index(-1023),
                -1023,
                -16,
                16 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(-65)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-65 - 1),
                sqrt_price_from_tick_index(-65),
                -65,
                -2,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(-64)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-64 - 1),
                sqrt_price_from_tick_index(-64),
                -64,
                -2,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(-32)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(-32 - 1),
                sqrt_price_from_tick_index(-32),
                -32,
                -1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(0)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(0 - 1),
                sqrt_price_from_tick_index(0),
                0,
                -1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(32)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(32 - 1),
                sqrt_price_from_tick_index(32),
                32,
                0,
                0,
            );
            // -1024 --> tick(64)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(64 - 1),
                sqrt_price_from_tick_index(64),
                64,
                0,
                0,
            );
            // -1024 --> tick(65)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(65 - 1),
                sqrt_price_from_tick_index(65),
                65,
                1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(127)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(127 - 1),
                sqrt_price_from_tick_index(127),
                127,
                1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> tick(128)
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(128 - 1),
                sqrt_price_from_tick_index(128),
                128,
                1,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // -1024 --> MAX_SQRT_PRICE
            test(
                a_to_b,
                -1024,
                sqrt_price_from_tick_index(64 * 88 * 2),
                MAX_SQRT_PRICE_X64,
                MAX_TICK_INDEX,
                (64 * 88 * 2) / tick_group_size,
                88 * 2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
        }

        #[test]
        fn test_a_to_b() {
            // right to left
            let a_to_b = true;
            let tick_group_size = 64;
            let max_volatility_accumulator = 64 * 88 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;

            // When a_to_b = true, calculate tick_index and tick_group_index from sqrt_price after skip, update volatility_accumulator.
            // Then, shift tick_group_index to the left by 1 for the next loop. If it is not a tick_group_size boundary, shifting will advance too much,
            // but tick_group_index is not recorded in the chain and the loop ends, so there is no adverse effect on subsequent processing.
            const LEFT_SHIFT: i32 = 1;

            // hit next tick
            // tick(1023) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(1023),
                sqrt_price_from_tick_index(1023),
                1023,
                15 - LEFT_SHIFT,
                15 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(65) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(65),
                sqrt_price_from_tick_index(65),
                65,
                1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(64) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(64),
                sqrt_price_from_tick_index(64),
                64,
                1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(32) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(32),
                sqrt_price_from_tick_index(32),
                32,
                0 - LEFT_SHIFT,
                0,
            );
            // tick(0) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(0),
                sqrt_price_from_tick_index(0),
                0,
                0 - LEFT_SHIFT,
                0,
            );
            // tick(-32) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-32),
                sqrt_price_from_tick_index(-32),
                -32,
                -1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-64) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-64),
                sqrt_price_from_tick_index(-64),
                -64,
                -1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-65) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-65),
                sqrt_price_from_tick_index(-65),
                -65,
                -2 - LEFT_SHIFT,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-127) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-127),
                sqrt_price_from_tick_index(-127),
                -127,
                -2 - LEFT_SHIFT,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-128) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-128),
                sqrt_price_from_tick_index(-128),
                -128,
                -2 - LEFT_SHIFT,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // MIN_SQRT_PRICE <-- 1024
            test(
                a_to_b,
                1024,
                MIN_SQRT_PRICE_X64,
                MIN_SQRT_PRICE_X64,
                MIN_TICK_INDEX,
                MIN_TICK_INDEX / tick_group_size - 1 - LEFT_SHIFT,
                max_volatility_accumulator,
            );

            // NOT hit next tick
            // tick(1023) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(1023) + 1,
                sqrt_price_from_tick_index(1023),
                1023,
                15 - LEFT_SHIFT,
                15 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(65) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(65 + 1),
                sqrt_price_from_tick_index(65),
                65,
                1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(64) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(64 + 1),
                sqrt_price_from_tick_index(64),
                64,
                1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(32) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(32 + 1),
                sqrt_price_from_tick_index(32),
                32,
                0 - LEFT_SHIFT,
                0,
            );
            // tick(0) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(1),
                sqrt_price_from_tick_index(0),
                0,
                0 - LEFT_SHIFT,
                0,
            );
            // tick(-32) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-32 + 1),
                sqrt_price_from_tick_index(-32),
                -32,
                -1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-64) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-64 + 1),
                sqrt_price_from_tick_index(-64),
                -64,
                -1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-65) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-65 + 1),
                sqrt_price_from_tick_index(-65),
                -65,
                -1 - LEFT_SHIFT,
                VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-127) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-127 + 1),
                sqrt_price_from_tick_index(-127),
                -127,
                -2 - LEFT_SHIFT,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // tick(-128) <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-128 + 1),
                sqrt_price_from_tick_index(-128),
                -128,
                -2 - LEFT_SHIFT,
                2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
            // MIN_SQRT_PRICE <-- 1024
            test(
                a_to_b,
                1024,
                sqrt_price_from_tick_index(-64 * 88 * 2),
                MIN_SQRT_PRICE_X64,
                MIN_TICK_INDEX,
                (-64 * 88 * 2) / tick_group_size - LEFT_SHIFT,
                88 * 2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
            );
        }
    }

    #[test]
    fn test_get_next_adaptive_fee_info() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 64;
        // reset references
        let timestamp = adaptive_fee_info
            .variables
            .last_reference_update_timestamp
            .max(adaptive_fee_info.variables.last_major_swap_timestamp)
            + adaptive_fee_info.constants.decay_period as u64;
        let mut fee_rate_manager = FeeRateManager::new(
            true,
            current_tick_index,
            timestamp,
            static_fee_rate,
            Some(adaptive_fee_info.clone()),
        )
        .unwrap();

        fee_rate_manager.update_volatility_accumulator().unwrap();
        fee_rate_manager.advance_tick_group();
        fee_rate_manager.update_volatility_accumulator().unwrap();
        fee_rate_manager.advance_tick_group();
        fee_rate_manager.update_volatility_accumulator().unwrap();

        check_tick_group_index_and_variables(
            &fee_rate_manager,
            -1,
            timestamp,
            adaptive_fee_info.variables.last_major_swap_timestamp,
            1,
            0,
            2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
        );

        let next_adaptive_fee_info = fee_rate_manager.get_next_adaptive_fee_info();
        match next_adaptive_fee_info {
            Some(AdaptiveFeeInfo {
                constants,
                variables,
            }) => {
                check_constants(
                    &constants,
                    adaptive_fee_info.constants.filter_period,
                    adaptive_fee_info.constants.decay_period,
                    adaptive_fee_info.constants.max_volatility_accumulator,
                    adaptive_fee_info.constants.reduction_factor,
                    adaptive_fee_info.constants.adaptive_fee_control_factor,
                    adaptive_fee_info.constants.tick_group_size,
                    adaptive_fee_info.constants.major_swap_threshold_ticks,
                );
                check_variables(
                    &variables,
                    timestamp,
                    adaptive_fee_info.variables.last_major_swap_timestamp,
                    1,
                    0,
                    2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
                );
            }
            _ => panic!("Some and Adaptive variant expected."),
        }
    }

    mod test_update_major_swap_timestamp {
        use super::*;

        #[test]
        fn test_a_to_b_minor() {
            let static_fee_rate = 3000;
            let adaptive_fee_info = adaptive_fee_info();

            let major_swap_threshold_ticks = adaptive_fee_info.constants.major_swap_threshold_ticks;
            assert!(major_swap_threshold_ticks > 1);

            let current_tick_index = 0;

            // keep reference
            let timestamp = adaptive_fee_info
                .variables
                .last_reference_update_timestamp
                .max(adaptive_fee_info.variables.last_major_swap_timestamp)
                + 1;
            let mut fee_rate_manager = FeeRateManager::new(
                true,
                current_tick_index,
                timestamp,
                static_fee_rate,
                Some(adaptive_fee_info.clone()),
            )
            .unwrap();

            let pre_sqrt_price = sqrt_price_from_tick_index(current_tick_index);
            let post_sqrt_price = sqrt_price_from_tick_index(
                current_tick_index - major_swap_threshold_ticks as i32 + 1,
            );

            fee_rate_manager
                .update_major_swap_timestamp(timestamp, pre_sqrt_price, post_sqrt_price)
                .unwrap();
            let next_variables = fee_rate_manager
                .get_next_adaptive_fee_info()
                .unwrap()
                .variables;

            // should not be updated
            assert!(
                next_variables.last_major_swap_timestamp
                    == adaptive_fee_info.variables.last_major_swap_timestamp
            );
            assert!(next_variables.last_major_swap_timestamp != timestamp);
        }

        #[test]
        fn test_a_to_b_major() {
            let static_fee_rate = 3000;
            let adaptive_fee_info = adaptive_fee_info();

            let major_swap_threshold_ticks = adaptive_fee_info.constants.major_swap_threshold_ticks;
            assert!(major_swap_threshold_ticks > 1);

            let current_tick_index = 0;

            // keep reference
            let timestamp = adaptive_fee_info
                .variables
                .last_reference_update_timestamp
                .max(adaptive_fee_info.variables.last_major_swap_timestamp)
                + 1;
            let mut fee_rate_manager = FeeRateManager::new(
                true,
                current_tick_index,
                timestamp,
                static_fee_rate,
                Some(adaptive_fee_info.clone()),
            )
            .unwrap();

            let pre_sqrt_price = sqrt_price_from_tick_index(current_tick_index);
            let post_sqrt_price = sqrt_price_from_tick_index(
                current_tick_index - major_swap_threshold_ticks as i32 - 1,
            );

            fee_rate_manager
                .update_major_swap_timestamp(timestamp, pre_sqrt_price, post_sqrt_price)
                .unwrap();
            let next_variables = fee_rate_manager
                .get_next_adaptive_fee_info()
                .unwrap()
                .variables;

            // should be updated
            assert!(
                next_variables.last_major_swap_timestamp
                    != adaptive_fee_info.variables.last_major_swap_timestamp
            );
            assert!(next_variables.last_major_swap_timestamp == timestamp);
        }

        #[test]
        fn test_b_to_a_minor() {
            let static_fee_rate = 3000;
            let adaptive_fee_info = adaptive_fee_info();

            let major_swap_threshold_ticks = adaptive_fee_info.constants.major_swap_threshold_ticks;
            assert!(major_swap_threshold_ticks > 1);

            let current_tick_index = 0;

            // keep reference
            let timestamp = adaptive_fee_info
                .variables
                .last_reference_update_timestamp
                .max(adaptive_fee_info.variables.last_major_swap_timestamp)
                + 1;
            let mut fee_rate_manager = FeeRateManager::new(
                false,
                current_tick_index,
                timestamp,
                static_fee_rate,
                Some(adaptive_fee_info.clone()),
            )
            .unwrap();

            let pre_sqrt_price = sqrt_price_from_tick_index(current_tick_index);
            let post_sqrt_price = sqrt_price_from_tick_index(
                current_tick_index + major_swap_threshold_ticks as i32 - 1,
            );

            fee_rate_manager
                .update_major_swap_timestamp(timestamp, pre_sqrt_price, post_sqrt_price)
                .unwrap();
            let next_variables = fee_rate_manager
                .get_next_adaptive_fee_info()
                .unwrap()
                .variables;

            // should not be updated
            assert!(
                next_variables.last_major_swap_timestamp
                    == adaptive_fee_info.variables.last_major_swap_timestamp
            );
            assert!(next_variables.last_major_swap_timestamp != timestamp);
        }

        #[test]
        fn test_b_to_a_major() {
            let static_fee_rate = 3000;
            let adaptive_fee_info = adaptive_fee_info();

            let major_swap_threshold_ticks = adaptive_fee_info.constants.major_swap_threshold_ticks;
            assert!(major_swap_threshold_ticks > 1);

            let current_tick_index = 0;

            // keep reference
            let timestamp = adaptive_fee_info
                .variables
                .last_reference_update_timestamp
                .max(adaptive_fee_info.variables.last_major_swap_timestamp)
                + 1;
            let mut fee_rate_manager = FeeRateManager::new(
                true,
                current_tick_index,
                timestamp,
                static_fee_rate,
                Some(adaptive_fee_info.clone()),
            )
            .unwrap();

            let pre_sqrt_price = sqrt_price_from_tick_index(current_tick_index);
            let post_sqrt_price = sqrt_price_from_tick_index(
                current_tick_index + major_swap_threshold_ticks as i32 + 1,
            );

            fee_rate_manager
                .update_major_swap_timestamp(timestamp, pre_sqrt_price, post_sqrt_price)
                .unwrap();
            let next_variables = fee_rate_manager
                .get_next_adaptive_fee_info()
                .unwrap()
                .variables;

            // should be updated
            assert!(
                next_variables.last_major_swap_timestamp
                    != adaptive_fee_info.variables.last_major_swap_timestamp
            );
            assert!(next_variables.last_major_swap_timestamp == timestamp);
        }
    }
}
