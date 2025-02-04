use anchor_lang::prelude::*;

use crate::math::tick_index_from_sqrt_price;

use super::Whirlpool;

pub const VOLATILITY_ACCUMULATOR_SCALE_FACTOR: u16 = 10_000;
pub const MAX_REDUCTION_FACTOR: u16 = 10_000;

pub const VA_FEE_CONTROL_FACTOR_DENOM: u32 = 100_000;

#[account(zero_copy(unsafe))]
#[repr(C, packed)]
pub struct Oracle {
    pub whirlpool: Pubkey,
    // DELEGATE ?
    pub va_fee_constants: VolatilityAdjustedFeeConstants,
    pub va_fee_variables: VolatilityAdjustedFeeVariables,
    // RESERVE to implement oracle (observation) in the future
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct VolatilityAdjustedFeeConstants {
    /// Period determine high frequency trading time window.
    pub filter_period: u16,
    /// Period determine when the volatile fee start decrease.
    pub decay_period: u16,
    /// Volatility adjusted fee rate decrement rate.
    pub reduction_factor: u16,
    /// Used to scale the volatility adjusted fee component.
    pub va_fee_control_factor: u32,
    /// Maximum number of ticks crossed can be accumulated. Used to cap volatility adjusted fee rate.
    pub max_volatility_accumulator: u32,

    /// tick_group = floor(tick_index / tick_group_size)
    /// it must be a divisor of tick spacing.
    pub tick_group_size: u16,
    // Padding for bytemuck safe alignment
}

impl VolatilityAdjustedFeeConstants {
    pub const LEN: usize = 2 + 2 + 2 + 4 + 4 + 2;
}

// #[zero_copy]

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct VolatilityAdjustedFeeVariables {
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

impl VolatilityAdjustedFeeVariables {
    pub const LEN: usize = 4 + 4 + 4 + 8;

    pub fn update_volatility_accumulator(
        &mut self,
        tick_group_index: i32,
        va_fee_constants: &VolatilityAdjustedFeeConstants,
    ) -> Result<()> {
      /* 
        let tick_group_index = tick_group_index_from_sqrt_price(
            a_to_b,
            current_sqrt_price,
            target_sqrt_price,
            va_fee_constants.tick_group_size,
        );
*/
        let index_delta = (self.tick_group_index_reference - tick_group_index).unsigned_abs();
        let volatility_accumulator = u64::from(self.volatility_reference)
            + u64::from(index_delta) * u64::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR);

        self.volatility_accumulator = std::cmp::min(
            volatility_accumulator,
            u64::from(va_fee_constants.max_volatility_accumulator),
        ) as u32;

        Ok(())
    }

    pub fn update_reference(
        &mut self,
        tick_group_index: i32,
        // a_to_b: bool,
        // current_sqrt_price: u128,
        // target_sqrt_price: u128,
        current_timestamp: i64,
        va_fee_constants: &VolatilityAdjustedFeeConstants,
    ) {
      /* 
        let tick_group_index = tick_group_index_from_sqrt_price(
            // TODO: reconsider edge case: price on the tick (exact)
            true, // a_to_b,
            current_sqrt_price,
            // TODO: reconsider edge case: price on the tick (exact)
            current_sqrt_price,
            // target_sqrt_price,
            va_fee_constants.tick_group_size,
        );
*/
        // TODO: remove unwrap
        let elapsed = current_timestamp
            .checked_sub(self.last_update_timestamp)
            .unwrap();

        if elapsed < va_fee_constants.filter_period as i64 {
            // high frequency trade
            // no change
        } else if elapsed < va_fee_constants.decay_period as i64 {
            // NOT high frequency trade
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = (u64::from(self.volatility_accumulator)
                * u64::from(va_fee_constants.reduction_factor)
                / u64::from(MAX_REDUCTION_FACTOR)) as u32;
        } else {
            // Out of decay time window
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = 0;
        }

        self.last_update_timestamp = current_timestamp;
    }
}

fn tick_group_index_from_sqrt_price(
    a_to_b: bool,
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    tick_group_size: u16,
) -> i32 {
    let tick_index = tick_index_from_sqrt_price(if a_to_b {
        &target_sqrt_price
    } else {
        &current_sqrt_price
    });

    // TODO: remove float operation
    (tick_index as f64 / tick_group_size as f64).floor() as i32
}

impl Oracle {
    // TODO: add reserve for observations
    pub const LEN: usize =
        8 + 32 + VolatilityAdjustedFeeConstants::LEN + VolatilityAdjustedFeeVariables::LEN;

    // TODO: simplify initialization, and use set_va_fee_constants instead
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        whirlpool: &Account<Whirlpool>,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        va_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
    ) -> Result<()> {
        self.whirlpool = whirlpool.key();

        // TODO: check values (e.g. MAX_REDUCTION_FACTOR)

        self.va_fee_constants = VolatilityAdjustedFeeConstants {
            filter_period,
            decay_period,
            reduction_factor,
            va_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        };
        self.va_fee_variables = VolatilityAdjustedFeeVariables {
            ..Default::default()
        };
        Ok(())
    }
}
