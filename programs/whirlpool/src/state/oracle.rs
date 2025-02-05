use std::cell::RefMut;
use anchor_lang::prelude::*;
use crate::manager::fee_rate_manager::{MAX_REDUCTION_FACTOR, VOLATILITY_ACCUMULATOR_SCALE_FACTOR};
use super::Whirlpool;

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct AdaptiveFeeConstants {
    // Period determine high frequency trading time window
    pub filter_period: u16,
    // Period determine when the volatile fee start decrease
    pub decay_period: u16,
    // Adaptive fee rate decrement rate
    pub reduction_factor: u16,
    // Used to scale the adaptive fee component
    pub adaptive_fee_control_factor: u32,
    // Maximum number of ticks crossed can be accumulated
    // Used to cap adaptive fee rate
    pub max_volatility_accumulator: u32,
    // tick_group is defined as floor(tick_index / tick_group_size)
    pub tick_group_size: u16,
}

impl AdaptiveFeeConstants {
    pub const LEN: usize = 2 + 2 + 2 + 4 + 4 + 2;
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct AdaptiveFeeVariables {
    // Last timestamp the variables was updated
    pub last_update_timestamp: i64,
    // Volatility reference is decayed volatility accumulator
    pub volatility_reference: u32,
    // Active tick group index of last swap
    pub tick_group_index_reference: i32,
    // Volatility accumulator measure the number of tick group crossed since reference tick group index (scaled)
    pub volatility_accumulator: u32,
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
        let elapsed = current_timestamp - self.last_update_timestamp;

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

#[derive(Debug, Default, Clone)]
pub struct AdaptiveFeeInfo {
    pub constants: AdaptiveFeeConstants,
    pub variables: AdaptiveFeeVariables,
}

#[account(zero_copy(unsafe))]
#[repr(C, packed)]
pub struct Oracle {
    pub whirlpool: Pubkey,
    pub adaptive_fee_constants: AdaptiveFeeConstants,
    pub adaptive_fee_variables: AdaptiveFeeVariables,
    // TODO: DELEGATE (adaptive_fee_authority_delegation) ?
    // TODO: RESERVE to implement oracle (observation) in the future
}

impl Oracle {
    // TODO: add reserve for observations
    pub const LEN: usize = 8 + 32 + AdaptiveFeeConstants::LEN + AdaptiveFeeVariables::LEN;

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

pub struct OracleAccessor<'info> {
    oracle_account_info: AccountInfo<'info>,
}

impl<'info> OracleAccessor<'info> {
    pub fn new(oracle_account_info: AccountInfo<'info>) -> Self {
        Self {
            oracle_account_info,
        }
    }

    pub fn get_adaptive_fee_info(&self) -> Result<Option<AdaptiveFeeInfo>> {
        let oracle = self.load_mut()?;
        match oracle {
            Some(oracle) => Ok(Some(AdaptiveFeeInfo {
                constants: oracle.adaptive_fee_constants,
                variables: oracle.adaptive_fee_variables,
            })),
            None => Ok(None),
        }
    }

    pub fn update_adaptive_fee_variables(
        &self,
        adaptive_fee_info: &Option<AdaptiveFeeInfo>,
    ) -> Result<()> {
        let oracle = self.load_mut()?;
        match (oracle, adaptive_fee_info) {
            // Oracle account has been initialized and adaptive fee info is provided
            (Some(mut oracle), Some(adaptive_fee_info)) => {
                oracle.adaptive_fee_variables = adaptive_fee_info.variables;
                Ok(())
            }
            // Oracle account has not been initialized and adaptive fee info is not provided
            (None, None) => Ok(()),
            _ => unreachable!(),
        }
    }

    fn load_mut(&self) -> Result<Option<RefMut<'_, Oracle>>> {
        use anchor_lang::Discriminator;
        use std::ops::DerefMut;

        // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
        // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
        // So we need to handle uninitialized account manually.

        // account must be writable
        if !self.oracle_account_info.is_writable {
            return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
        }

        // uninitialized writable account (owned by system program and its data size is zero)
        if self.oracle_account_info.owner == &System::id()
            && self.oracle_account_info.data_is_empty()
        {
            // oracle is not initialized
            return Ok(None);
        }

        // owner program check
        if self.oracle_account_info.owner != &Oracle::owner() {
            return Err(
                Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                    .with_pubkeys((*self.oracle_account_info.owner, Oracle::owner())),
            );
        }

        let data = self.oracle_account_info.try_borrow_mut_data()?;
        if data.len() < Oracle::discriminator().len() {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        }

        let disc_bytes = arrayref::array_ref![data, 0, 8];
        if disc_bytes != &Oracle::discriminator() {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
        }

        let oracle_refmut: RefMut<Oracle> = RefMut::map(data, |data| {
            bytemuck::from_bytes_mut(&mut data.deref_mut()[8..std::mem::size_of::<Oracle>() + 8])
        });

        Ok(Some(oracle_refmut))
    }
}
