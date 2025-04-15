use orca_whirlpools_core::{OracleFacade, AdaptiveFeeConstantsFacade, AdaptiveFeeVariablesFacade};

use crate::{Oracle, AdaptiveFeeConstants, AdaptiveFeeVariables};

impl From<Oracle> for OracleFacade {
    fn from(val: Oracle) -> Self {
        OracleFacade {
          trade_enable_timestamp: val.trade_enable_timestamp,
          adaptive_fee_constants: val.adaptive_fee_constants.into(),
          adaptive_fee_variables: val.adaptive_fee_variables.into(),
        }
    }
}

impl From<AdaptiveFeeConstants> for AdaptiveFeeConstantsFacade {
    fn from(val: AdaptiveFeeConstants) -> Self {
        AdaptiveFeeConstantsFacade {
            filter_period: val.filter_period,
            decay_period: val.decay_period,
            reduction_factor: val.reduction_factor,
            adaptive_fee_control_factor: val.adaptive_fee_control_factor,
            max_volatility_accumulator: val.max_volatility_accumulator,
            tick_group_size: val.tick_group_size,
            major_swap_threshold_ticks: val.major_swap_threshold_ticks,
        }
    }
}

impl From<AdaptiveFeeVariables> for AdaptiveFeeVariablesFacade {
    fn from(val: AdaptiveFeeVariables) -> Self {
        AdaptiveFeeVariablesFacade {
            last_reference_update_timestamp: val.last_reference_update_timestamp,
            last_major_swap_timestamp: val.last_major_swap_timestamp,
            volatility_reference: val.volatility_reference,
            tick_group_index_reference: val.tick_group_index_reference,
            volatility_accumulator: val.volatility_accumulator,
        }
    }
}
