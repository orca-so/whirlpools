use crate::{
    math::{ceil_division, floor_division, sqrt_price_from_tick_index},
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

pub enum FeeRateManager {
    Adaptive {
        a_to_b: bool,
        tick_group_index: i32,
        static_fee_rate: u16,
        adaptive_fee_constants: AdaptiveFeeConstants,
        adaptive_fee_variables: AdaptiveFeeVariables,
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

                Ok(Self::Adaptive {
                    a_to_b,
                    tick_group_index,
                    static_fee_rate,
                    adaptive_fee_constants,
                    adaptive_fee_variables,
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

    pub fn get_bounded_sqrt_price_target(&self, sqrt_price: u128) -> u128 {
        match self {
            Self::Static { .. } => sqrt_price,
            Self::Adaptive {
                a_to_b,
                tick_group_index,
                adaptive_fee_constants,
                ..
            } => {
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
                    sqrt_price.max(boundary_sqrt_price)
                } else {
                    sqrt_price.min(boundary_sqrt_price)
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
            let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
            assert_eq!(bounded_sqrt_price, sqrt_price);
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
            },
            variables: AdaptiveFeeVariables {
                last_update_timestamp: 1738863309,
                tick_group_index_reference: 1,
                volatility_reference: 500,
                volatility_accumulator: 10000,
            },
        }
    }

    fn check_constants(
        adaptive_fee_constants: &AdaptiveFeeConstants,
        filter_period: u16,
        decay_period: u16,
        max_volatility_accumulator: u32,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        tick_group_size: u16,
    ) {
        assert!(adaptive_fee_constants.filter_period == filter_period);
        assert!(adaptive_fee_constants.decay_period == decay_period);
        assert!(adaptive_fee_constants.max_volatility_accumulator == max_volatility_accumulator);
        assert!(adaptive_fee_constants.reduction_factor == reduction_factor);
        assert!(adaptive_fee_constants.adaptive_fee_control_factor == adaptive_fee_control_factor);
        assert!(adaptive_fee_constants.tick_group_size == tick_group_size);
    }

    fn check_variables(
        adaptive_fee_variables: &AdaptiveFeeVariables,
        last_update_timestamp: u64,
        tick_group_index_reference: i32,
        volatility_reference: u32,
        volatility_accumulator: u32,
    ) {
        assert!(adaptive_fee_variables.last_update_timestamp == last_update_timestamp);
        assert!(adaptive_fee_variables.tick_group_index_reference == tick_group_index_reference);
        assert!(adaptive_fee_variables.volatility_reference == volatility_reference);
        assert!(adaptive_fee_variables.volatility_accumulator == volatility_accumulator);
    }

    fn check_tick_group_index_and_variables(
        fee_rate_manager: &FeeRateManager,
        tick_group_index: i32,
        last_update_timestamp: u64,
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
                    last_update_timestamp,
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

        let current_tick_index = 1024;
        let timestamp = adaptive_fee_info.variables.last_update_timestamp + 1;
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
            } => {
                assert!(a_to_b);
                assert_eq!(tick_group_index, 16);
                assert_eq!(rate, static_fee_rate);
                check_constants(
                    &adaptive_fee_constants,
                    adaptive_fee_info.constants.filter_period,
                    adaptive_fee_info.constants.decay_period,
                    adaptive_fee_info.constants.max_volatility_accumulator,
                    adaptive_fee_info.constants.reduction_factor,
                    adaptive_fee_info.constants.adaptive_fee_control_factor,
                    adaptive_fee_info.constants.tick_group_size,
                );
                // update_reference should be called
                check_variables(
                    &adaptive_fee_variables,
                    timestamp, // timestamp should be updated
                    // both reference should not be updated (< filter_period)
                    adaptive_fee_info.variables.tick_group_index_reference,
                    adaptive_fee_info.variables.volatility_reference,
                    adaptive_fee_info.variables.volatility_accumulator,
                );
            }
            _ => panic!("Adaptive variant expected."),
        }

        let current_tick_index = 1024;
        let timestamp = adaptive_fee_info.variables.last_update_timestamp
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
            } => {
                assert!(!a_to_b);
                assert_eq!(tick_group_index, 16);
                assert_eq!(rate, static_fee_rate);
                check_constants(
                    &adaptive_fee_constants,
                    adaptive_fee_info.constants.filter_period,
                    adaptive_fee_info.constants.decay_period,
                    adaptive_fee_info.constants.max_volatility_accumulator,
                    adaptive_fee_info.constants.reduction_factor,
                    adaptive_fee_info.constants.adaptive_fee_control_factor,
                    adaptive_fee_info.constants.tick_group_size,
                );
                // update_reference should be called
                check_variables(
                    &adaptive_fee_variables,
                    timestamp, // timestamp should be updated
                    // both reference should be updated (>= decay_period)
                    16,
                    0,
                    adaptive_fee_info.variables.volatility_accumulator,
                );
            }
            _ => panic!("Adaptive variant expected."),
        }
    }

    #[test]
    fn test_update_volatility_accumulator_and_advance_tick_group_b_to_a() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 1024;
        // reset references
        let timestamp = adaptive_fee_info.variables.last_update_timestamp
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
        check_tick_group_index_and_variables(&fee_rate_manager, 16, timestamp, 16, 0, 0);

        // delta = 1
        fee_rate_manager.advance_tick_group(); // 16 to 17 (b to a)
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            17,
            timestamp,
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
        let timestamp = adaptive_fee_info.variables.last_update_timestamp
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
        check_tick_group_index_and_variables(&fee_rate_manager, 1, timestamp, 1, 0, 0);

        // delta = 1
        fee_rate_manager.advance_tick_group(); // 1 to 0 (a to b)
        fee_rate_manager.update_volatility_accumulator().unwrap();
        check_tick_group_index_and_variables(
            &fee_rate_manager,
            0,
            timestamp,
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
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
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
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
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
                    filter_period: 30,
                    decay_period: 600,
                    reduction_factor: 5000,
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
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
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
    fn test_get_bounded_sqrt_price_target_a_to_b() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info.variables.last_update_timestamp
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
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price);

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024);
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price);

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 - 16);
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024));

        // sqrt_price is very far than the boundary
        let sqrt_price = MIN_SQRT_PRICE_X64;
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024));

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MIN_SQRT_PRICE_X64;
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 - 64));
    }

    #[test]
    fn test_get_bounded_sqrt_price_target_b_to_a() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 1024 + 32;
        // reset references
        let timestamp = adaptive_fee_info.variables.last_update_timestamp
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
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price);

        // sqrt_price is on the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64);
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price);

        // sqrt_price is far than the boundary
        let sqrt_price = sqrt_price_from_tick_index(1024 + 64 + 16);
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 + 64));

        // sqrt_price is very far than the boundary
        let sqrt_price = MAX_SQRT_PRICE_X64;
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(bounded_sqrt_price, sqrt_price_from_tick_index(1024 + 64));

        fee_rate_manager.advance_tick_group();

        let sqrt_price = MAX_SQRT_PRICE_X64;
        let bounded_sqrt_price = fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price);
        assert_eq!(
            bounded_sqrt_price,
            sqrt_price_from_tick_index(1024 + 64 + 64)
        );
    }

    #[test]
    fn test_get_next_adaptive_fee_info() {
        let static_fee_rate = 3000;
        let adaptive_fee_info = adaptive_fee_info();

        let current_tick_index = 64;
        // reset references
        let timestamp = adaptive_fee_info.variables.last_update_timestamp
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
                );
                check_variables(
                    &variables,
                    timestamp,
                    1,
                    0,
                    2 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32,
                );
            }
            _ => panic!("Some and Adaptive variant expected."),
        }
    }
}
