use anchor_lang::prelude::*;

use crate::manager::fee_rate_manager::{MAX_REDUCTION_FACTOR, VOLATILITY_ACCUMULATOR_SCALE_FACTOR};

use super::Whirlpool;

#[account(zero_copy(unsafe))]
#[repr(C, packed)]
pub struct Oracle {
    pub whirlpool: Pubkey,
    // DELEGATE ?
    pub adaptive_fee_constants: AdaptiveFeeConstants,
    pub adaptive_fee_variables: AdaptiveFeeVariables,
    // RESERVE to implement oracle (observation) in the future
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct AdaptiveFeeConstants {
    /// Period determine high frequency trading time window.
    pub filter_period: u16,
    /// Period determine when the volatile fee start decrease.
    pub decay_period: u16,
    /// Adaptive fee rate decrement rate.
    pub reduction_factor: u16,
    /// Used to scale the adaptive fee component.
    pub adaptive_fee_control_factor: u32,
    /// Maximum number of ticks crossed can be accumulated. Used to cap adaptive fee rate.
    pub max_volatility_accumulator: u32,

    /// tick_group = floor(tick_index / tick_group_size)
    /// it must be a divisor of tick spacing.
    pub tick_group_size: u16,
    // Padding for bytemuck safe alignment
}

impl AdaptiveFeeConstants {
    pub const LEN: usize = 2 + 2 + 2 + 4 + 4 + 2;
}

// #[zero_copy]

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct AdaptiveFeeVariables {
    /// Last timestamp the variables was updated
    pub last_update_timestamp: i64,

    // tick index in this context should be "initializable" tick.
    // In splash pool, it should be more smaller value than tick spacing.
    // This unit should be defined in Constants.
    /// Volatility reference is decayed volatility accumulator.
    pub volatility_reference: u32,
    /// Active tick group index of last swap.
    pub tick_group_index_reference: i32,

    /// Volatility accumulator measure the number of tick group crossed since reference tick index.
    pub volatility_accumulator: u32,
    // Padding for bytemuck safe alignment

    // Padding for bytemuck safe alignment
}

impl AdaptiveFeeVariables {
    pub const LEN: usize = 4 + 4 + 4 + 8;

    pub fn update_volatility_accumulator(
        &mut self,
        tick_group_index: i32,
        adaptive_fee_constants: &AdaptiveFeeConstants,
    ) -> Result<()> {
        let index_delta = (self.tick_group_index_reference - tick_group_index).unsigned_abs();
        let volatility_accumulator = u64::from(self.volatility_reference)
            + u64::from(index_delta) * u64::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR);

        self.volatility_accumulator = std::cmp::min(
            volatility_accumulator,
            u64::from(adaptive_fee_constants.max_volatility_accumulator),
        ) as u32;

        Ok(())
    }

    pub fn update_reference(
        &mut self,
        tick_group_index: i32,
        current_timestamp: i64,
        adaptive_fee_constants: &AdaptiveFeeConstants,
    ) {
        // TODO: remove unwrap
        let elapsed = current_timestamp
            .checked_sub(self.last_update_timestamp)
            .unwrap();

        if elapsed < adaptive_fee_constants.filter_period as i64 {
            // high frequency trade
            // no change
        } else if elapsed < adaptive_fee_constants.decay_period as i64 {
            // NOT high frequency trade
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = (u64::from(self.volatility_accumulator)
                * u64::from(adaptive_fee_constants.reduction_factor)
                / u64::from(MAX_REDUCTION_FACTOR)) as u32;
        } else {
            // Out of decay time window
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = 0;
        }

        self.last_update_timestamp = current_timestamp;
    }
}

impl Oracle {
    // TODO: add reserve for observations
    pub const LEN: usize =
        8 + 32 + AdaptiveFeeConstants::LEN + AdaptiveFeeVariables::LEN;

    // TODO: simplify initialization, and use set_va_fee_constants instead
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        whirlpool: &Account<Whirlpool>,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
    ) -> Result<()> {
        self.whirlpool = whirlpool.key();

        // TODO: check values (e.g. MAX_REDUCTION_FACTOR)

        self.adaptive_fee_constants = AdaptiveFeeConstants {
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        };
        self.adaptive_fee_variables = AdaptiveFeeVariables {
            ..Default::default()
        };
        Ok(())
    }

    pub fn update_adaptive_fee_constants(&mut self, constants: AdaptiveFeeConstants) {
        self.adaptive_fee_constants = constants;
    }

    pub fn update_adaptive_fee_variables(&mut self, variables: AdaptiveFeeVariables) {
        self.adaptive_fee_variables = variables;
    }
}
