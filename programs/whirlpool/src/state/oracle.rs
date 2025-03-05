use crate::errors::ErrorCode;
use crate::manager::fee_rate_manager::{
    ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR, REDUCTION_FACTOR_DENOMINATOR,
    VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
};
use anchor_lang::prelude::*;
use std::cell::{Ref, RefMut};

pub const MAX_TRADE_ENABLE_TIMESTAMP_DELTA: u64 = 60 * 60 * 72; // 72 hours

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct AdaptiveFeeConstants {
    // Period determine high frequency trading time window
    // The unit of time is "seconds" and is applied to the chain's block time
    pub filter_period: u16,
    // Period determine when the adaptive fee start decrease
    // The unit of time is "seconds" and is applied to the chain's block time
    pub decay_period: u16,
    // Adaptive fee rate decrement rate
    pub reduction_factor: u16,
    // Used to scale the adaptive fee component
    pub adaptive_fee_control_factor: u32,
    // Maximum number of ticks crossed can be accumulated
    // Used to cap adaptive fee rate
    pub max_volatility_accumulator: u32,
    // Tick group index is defined as floor(tick_index / tick_group_size)
    pub tick_group_size: u16,
}

impl AdaptiveFeeConstants {
    pub const LEN: usize = 2 + 2 + 2 + 4 + 4 + 2;

    pub fn validate_constants(
        tick_spacing: u16,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
    ) -> bool {
        // filter_period validation
        // must be >= 1
        if filter_period == 0 {
            return false;
        }

        // decay_period validation
        // must be >= 1 and > filter_period
        if decay_period == 0 || decay_period <= filter_period {
            return false;
        }

        // adaptive_fee_control_factor validation
        // must be less than ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR
        if adaptive_fee_control_factor >= ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR {
            return false;
        }

        // max_volatility_accumulator validation
        // this constraint is to prevent overflow at FeeRateManager::compute_adaptive_fee_rate
        if u64::from(max_volatility_accumulator) * u64::from(tick_group_size) > u32::MAX as u64 {
            return false;
        }

        // reduction_factor validation
        if reduction_factor >= REDUCTION_FACTOR_DENOMINATOR {
            return false;
        }

        // tick_group_size validation
        if tick_group_size == 0
            || tick_group_size > tick_spacing
            || tick_spacing % tick_group_size != 0
        {
            return false;
        }

        true
    }
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug)]
pub struct AdaptiveFeeVariables {
    // Last timestamp (block time) the variables was updated
    pub last_update_timestamp: u64,
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
        current_timestamp: u64,
        adaptive_fee_constants: &AdaptiveFeeConstants,
    ) -> Result<()> {
        if current_timestamp < self.last_update_timestamp {
            return Err(ErrorCode::InvalidTimestamp.into());
        }

        let elapsed = current_timestamp - self.last_update_timestamp;

        if elapsed < adaptive_fee_constants.filter_period as u64 {
            // high frequency trade
            // no change
        } else if elapsed < adaptive_fee_constants.decay_period as u64 {
            // NOT high frequency trade
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = (u64::from(self.volatility_accumulator)
                * u64::from(adaptive_fee_constants.reduction_factor)
                / u64::from(REDUCTION_FACTOR_DENOMINATOR))
                as u32;
        } else {
            // Out of decay time window
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = 0;
        }

        self.last_update_timestamp = current_timestamp;

        Ok(())
    }
}

#[derive(Debug, Default, Clone)]
pub struct AdaptiveFeeInfo {
    pub constants: AdaptiveFeeConstants,
    pub variables: AdaptiveFeeVariables,
}

#[account(zero_copy(unsafe))]
#[repr(C, packed)]
#[derive(Debug)]
pub struct Oracle {
    pub whirlpool: Pubkey,
    pub trade_enable_timestamp: u64,
    pub adaptive_fee_constants: AdaptiveFeeConstants,
    pub adaptive_fee_variables: AdaptiveFeeVariables,
    _reserved: [u8; 256], // for bytemuck mapping
}

impl Default for Oracle {
    fn default() -> Self {
        Self {
            whirlpool: Pubkey::default(),
            trade_enable_timestamp: 0,
            adaptive_fee_constants: AdaptiveFeeConstants::default(),
            adaptive_fee_variables: AdaptiveFeeVariables::default(),
            _reserved: [0u8; 256],
        }
    }
}

impl Oracle {
    pub const LEN: usize = 8 + 32 + 8 + AdaptiveFeeConstants::LEN + AdaptiveFeeVariables::LEN + 256;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        whirlpool: Pubkey,
        trade_enable_timestamp: Option<u64>,
        tick_spacing: u16,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
    ) -> Result<()> {
        self.whirlpool = whirlpool;
        self.trade_enable_timestamp = trade_enable_timestamp.unwrap_or(0);

        let constants = AdaptiveFeeConstants {
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        };

        self.initialize_adaptive_fee_constants(constants, tick_spacing)?;
        self.reset_adaptive_fee_variables();

        Ok(())
    }

    pub fn initialize_adaptive_fee_constants(
        &mut self,
        constants: AdaptiveFeeConstants,
        tick_spacing: u16,
    ) -> Result<()> {
        if !AdaptiveFeeConstants::validate_constants(
            tick_spacing,
            constants.filter_period,
            constants.decay_period,
            constants.reduction_factor,
            constants.adaptive_fee_control_factor,
            constants.max_volatility_accumulator,
            constants.tick_group_size,
        ) {
            return Err(ErrorCode::InvalidAdaptiveFeeConstants.into());
        }

        self.adaptive_fee_constants = constants;

        Ok(())
    }

    pub fn update_adaptive_fee_variables(&mut self, variables: AdaptiveFeeVariables) {
        self.adaptive_fee_variables = variables;
    }

    fn reset_adaptive_fee_variables(&mut self) {
        self.adaptive_fee_variables = AdaptiveFeeVariables::default();
    }
}

pub struct OracleAccessor<'info> {
    oracle_account_info: AccountInfo<'info>,
    oracle_account_initialized: bool,
}

impl<'info> OracleAccessor<'info> {
    pub fn new(oracle_account_info: AccountInfo<'info>) -> Result<Self> {
        let oracle_account_initialized = Self::is_oracle_account_initialized(&oracle_account_info)?;
        Ok(Self {
            oracle_account_info,
            oracle_account_initialized,
        })
    }

    pub fn is_trade_enabled(&self, current_timestamp: u64) -> Result<bool> {
        if !self.oracle_account_initialized {
            return Ok(true);
        }

        let oracle = self.load()?;
        Ok(oracle.trade_enable_timestamp <= current_timestamp)
    }

    pub fn get_adaptive_fee_info(&self) -> Result<Option<AdaptiveFeeInfo>> {
        if !self.oracle_account_initialized {
            return Ok(None);
        }

        let oracle = self.load()?;
        Ok(Some(AdaptiveFeeInfo {
            constants: oracle.adaptive_fee_constants,
            variables: oracle.adaptive_fee_variables,
        }))
    }

    pub fn update_adaptive_fee_variables(
        &self,
        adaptive_fee_info: &Option<AdaptiveFeeInfo>,
    ) -> Result<()> {
        // If the Oracle account is not initialized, load_mut access will be skipped.
        // In other words, no need for writable flag on the Oracle account if it is not initialized.

        match (self.oracle_account_initialized, adaptive_fee_info) {
            // Oracle account has been initialized and adaptive fee info is provided
            (true, Some(adaptive_fee_info)) => {
                let mut oracle = self.load_mut()?;
                oracle.update_adaptive_fee_variables(adaptive_fee_info.variables);
                Ok(())
            }
            // Oracle account has not been initialized and adaptive fee info is not provided
            (false, None) => Ok(()),
            _ => unreachable!(),
        }
    }

    fn is_oracle_account_initialized(oracle_account_info: &AccountInfo<'info>) -> Result<bool> {
        use anchor_lang::Discriminator;

        // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
        // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
        // So we need to handle uninitialized account manually.

        // Note: intentionally do not check if the account is writable here, defer the evaluation until load_mut is called

        // uninitialized account (owned by system program and its data size is zero)
        if oracle_account_info.owner == &System::id()
            && oracle_account_info.data_is_empty()
        {
            // oracle is not initialized
            return Ok(false);
        }

        // owner program check
        if oracle_account_info.owner != &Oracle::owner() {
            return Err(
                Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
                    .with_pubkeys((*oracle_account_info.owner, Oracle::owner())),
            );
        }

        let data = oracle_account_info.try_borrow_data()?;
        if data.len() < Oracle::discriminator().len() {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        }

        let disc_bytes = arrayref::array_ref![data, 0, 8];
        if disc_bytes != &Oracle::discriminator() {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
        }

        Ok(true)
    }

    fn load(&self) -> Result<Ref<'_, Oracle>> {
        // is_oracle_account_initialized already checked if the account is initialized

        let data = self.oracle_account_info.try_borrow_data()?;
        let oracle_refmut: Ref<Oracle> = Ref::map(data, |data| {
            bytemuck::from_bytes(&data[8..std::mem::size_of::<Oracle>() + 8])
        });

        Ok(oracle_refmut)
    }

    fn load_mut(&self) -> Result<RefMut<'_, Oracle>> {
        // is_oracle_account_initialized already checked if the account is initialized

        use std::ops::DerefMut;

        // account must be writable
        if !self.oracle_account_info.is_writable {
            return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
        }

        let data = self.oracle_account_info.try_borrow_mut_data()?;
        let oracle_refmut: RefMut<Oracle> = RefMut::map(data, |data| {
            bytemuck::from_bytes_mut(&mut data.deref_mut()[8..std::mem::size_of::<Oracle>() + 8])
        });

        Ok(oracle_refmut)
    }
}

#[cfg(test)]
mod data_layout_tests {
    use super::*;

    #[test]
    fn test_oracle_data_layout() {
        let oracle_reserved = [0u8; 256];

        let oracle_whirlpool = Pubkey::new_unique();
        let oracle_trade_enable_timestamp = 0x1122334455667788u64;

        let af_const_filter_period = 0x1122u16;
        let af_const_decay_period = 0x3344u16;
        let af_const_reduction_factor = 0x5566u16;
        let af_const_adaptive_fee_control_factor = 0x778899aau32;
        let af_const_max_volatility_accumulator = 0xaabbccddu32;
        let af_const_tick_group_size = 0xeeffu16;

        let af_var_last_update_timestamp = 0x1122334455667788u64;
        let af_var_volatility_reference = 0x99aabbccu32;
        let af_var_tick_group_index_reference = 0x00ddeeffi32;
        let af_var_volatility_accumulator = 0x11223344u32;

        // manually build the expected AdaptiveFeeConstants data layout
        let mut af_const_data = [0u8; AdaptiveFeeConstants::LEN];
        let mut offset = 0;
        af_const_data[offset..offset + 2].copy_from_slice(&af_const_filter_period.to_le_bytes());
        offset += 2;
        af_const_data[offset..offset + 2].copy_from_slice(&af_const_decay_period.to_le_bytes());
        offset += 2;
        af_const_data[offset..offset + 2].copy_from_slice(&af_const_reduction_factor.to_le_bytes());
        offset += 2;
        af_const_data[offset..offset + 4]
            .copy_from_slice(&af_const_adaptive_fee_control_factor.to_le_bytes());
        offset += 4;
        af_const_data[offset..offset + 4]
            .copy_from_slice(&af_const_max_volatility_accumulator.to_le_bytes());
        offset += 4;
        af_const_data[offset..offset + 2].copy_from_slice(&af_const_tick_group_size.to_le_bytes());
        offset += 2;

        assert_eq!(offset, af_const_data.len());

        // manually build the expected AdaptiveFeeVariables data layout
        let mut af_var_data = [0u8; AdaptiveFeeVariables::LEN];
        let mut offset = 0;
        af_var_data[offset..offset + 8]
            .copy_from_slice(&af_var_last_update_timestamp.to_le_bytes());
        offset += 8;
        af_var_data[offset..offset + 4].copy_from_slice(&af_var_volatility_reference.to_le_bytes());
        offset += 4;
        af_var_data[offset..offset + 4]
            .copy_from_slice(&af_var_tick_group_index_reference.to_le_bytes());
        offset += 4;
        af_var_data[offset..offset + 4]
            .copy_from_slice(&af_var_volatility_accumulator.to_le_bytes());
        offset += 4;

        assert_eq!(offset, af_var_data.len());

        // manually build the expected Oracle data layout
        // note: no discriminator
        let mut oracle_data = [0u8; Oracle::LEN - 8];
        let mut offset = 0;
        oracle_data[offset..offset + 32].copy_from_slice(oracle_whirlpool.as_ref());
        offset += 32;
        oracle_data[offset..offset + 8].copy_from_slice(&oracle_trade_enable_timestamp.to_le_bytes());
        offset += 8;
        oracle_data[offset..offset + AdaptiveFeeConstants::LEN].copy_from_slice(&af_const_data);
        offset += AdaptiveFeeConstants::LEN;
        oracle_data[offset..offset + AdaptiveFeeVariables::LEN].copy_from_slice(&af_var_data);
        offset += AdaptiveFeeVariables::LEN;
        oracle_data[offset..offset + oracle_reserved.len()].copy_from_slice(&oracle_reserved);
        offset += oracle_reserved.len();

        assert_eq!(offset, Oracle::LEN - 8);

        // cast from bytes to Oracle (re-interpret)
        let oracle: &Oracle = bytemuck::from_bytes(&oracle_data);

        // check that the data layout matches the expected layout
        assert_eq!(oracle.whirlpool, oracle_whirlpool);
        let read_trade_enable_timestamp = oracle.trade_enable_timestamp;
        assert_eq!(read_trade_enable_timestamp, oracle_trade_enable_timestamp);

        let read_af_const_filter_period = oracle.adaptive_fee_constants.filter_period;
        assert_eq!(read_af_const_filter_period, af_const_filter_period);
        let read_af_const_decay_period = oracle.adaptive_fee_constants.decay_period;
        assert_eq!(read_af_const_decay_period, af_const_decay_period);
        let read_af_const_reduction_factor = oracle.adaptive_fee_constants.reduction_factor;
        assert_eq!(read_af_const_reduction_factor, af_const_reduction_factor);
        let read_af_const_adaptive_fee_control_factor =
            oracle.adaptive_fee_constants.adaptive_fee_control_factor;
        assert_eq!(
            read_af_const_adaptive_fee_control_factor,
            af_const_adaptive_fee_control_factor
        );
        let read_af_const_max_volatility_accumulator =
            oracle.adaptive_fee_constants.max_volatility_accumulator;
        assert_eq!(
            read_af_const_max_volatility_accumulator,
            af_const_max_volatility_accumulator
        );
        let read_af_const_tick_group_size = oracle.adaptive_fee_constants.tick_group_size;
        assert_eq!(read_af_const_tick_group_size, af_const_tick_group_size);

        let read_af_var_last_update_timestamp = oracle.adaptive_fee_variables.last_update_timestamp;
        assert_eq!(
            read_af_var_last_update_timestamp,
            af_var_last_update_timestamp
        );
        let read_af_var_volatility_reference = oracle.adaptive_fee_variables.volatility_reference;
        assert_eq!(
            read_af_var_volatility_reference,
            af_var_volatility_reference
        );
        let read_af_var_tick_group_index_reference =
            oracle.adaptive_fee_variables.tick_group_index_reference;
        assert_eq!(
            read_af_var_tick_group_index_reference,
            af_var_tick_group_index_reference
        );
        let read_af_var_volatility_accumulator =
            oracle.adaptive_fee_variables.volatility_accumulator;
        assert_eq!(
            read_af_var_volatility_accumulator,
            af_var_volatility_accumulator
        );
    }
}

#[cfg(test)]
mod oracle_tests {
    use super::*;

    #[test]
    fn test_update_adaptive_fee_constants() {
        let mut oracle = Oracle::default();

        let filter_period = 0x1122u16;
        let decay_period = 0x3344u16;
        let reduction_factor = 0x2266u16; // must be < MAX_REDUCTION_FACTOR
        let adaptive_fee_control_factor = 0x000122aau32; // must be < ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR
        let max_volatility_accumulator = 0x00bbccddu32;
        let tick_group_size = 0x00ffu16;

        let constants = AdaptiveFeeConstants {
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
        };

        oracle
            .initialize_adaptive_fee_constants(constants, tick_group_size)
            .unwrap();

        let read_af_const_filter_period = oracle.adaptive_fee_constants.filter_period;
        assert_eq!(read_af_const_filter_period, filter_period);
        let read_af_const_decay_period = oracle.adaptive_fee_constants.decay_period;
        assert_eq!(read_af_const_decay_period, decay_period);
        let read_af_const_reduction_factor = oracle.adaptive_fee_constants.reduction_factor;
        assert_eq!(read_af_const_reduction_factor, reduction_factor);
        let read_af_const_adaptive_fee_control_factor =
            oracle.adaptive_fee_constants.adaptive_fee_control_factor;
        assert_eq!(
            read_af_const_adaptive_fee_control_factor,
            adaptive_fee_control_factor
        );
        let read_af_const_max_volatility_accumulator =
            oracle.adaptive_fee_constants.max_volatility_accumulator;
        assert_eq!(
            read_af_const_max_volatility_accumulator,
            max_volatility_accumulator
        );
        let read_af_const_tick_group_size = oracle.adaptive_fee_constants.tick_group_size;
        assert_eq!(read_af_const_tick_group_size, tick_group_size);
    }

    #[test]
    fn test_update_adaptive_fee_variables() {
        let mut oracle = Oracle::default();

        let last_update_timestamp = 0x1122334455667788u64;
        let volatility_reference = 0x99aabbccu32;
        let tick_group_index_reference = 0x00ddeeffi32;
        let volatility_accumulator = 0x11223344u32;

        let variables = AdaptiveFeeVariables {
            last_update_timestamp,
            volatility_reference,
            tick_group_index_reference,
            volatility_accumulator,
        };

        oracle.update_adaptive_fee_variables(variables);

        let read_af_var_last_update_timestamp = oracle.adaptive_fee_variables.last_update_timestamp;
        assert_eq!(read_af_var_last_update_timestamp, last_update_timestamp);
        let read_af_var_volatility_reference = oracle.adaptive_fee_variables.volatility_reference;
        assert_eq!(read_af_var_volatility_reference, volatility_reference);
        let read_af_var_tick_group_index_reference =
            oracle.adaptive_fee_variables.tick_group_index_reference;
        assert_eq!(
            read_af_var_tick_group_index_reference,
            tick_group_index_reference
        );
        let read_af_var_volatility_accumulator =
            oracle.adaptive_fee_variables.volatility_accumulator;
        assert_eq!(read_af_var_volatility_accumulator, volatility_accumulator);
    }
}

#[cfg(test)]
mod adaptive_fee_variables_tests {
    use super::*;

    fn constants_for_test() -> AdaptiveFeeConstants {
        AdaptiveFeeConstants {
            filter_period: 30,
            decay_period: 600,
            reduction_factor: 3000, // 3000 / 10000 = 30%
            adaptive_fee_control_factor: 4_000,
            max_volatility_accumulator: 350_000,
            tick_group_size: 64,
        }
    }

    fn check_variables(
        variables: &AdaptiveFeeVariables,
        last_update_timestamp: u64,
        tick_group_index_reference: i32,
        volatility_reference: u32,
        volatility_accumulator: u32,
    ) {
        let read_last_update_timestamp = variables.last_update_timestamp;
        assert_eq!(read_last_update_timestamp, last_update_timestamp);
        let read_tick_group_index_reference = variables.tick_group_index_reference;
        assert_eq!(read_tick_group_index_reference, tick_group_index_reference);
        let read_volatility_reference = variables.volatility_reference;
        assert_eq!(read_volatility_reference, volatility_reference);
        let read_volatility_accumulator = variables.volatility_accumulator;
        assert_eq!(read_volatility_accumulator, volatility_accumulator);
    }

    mod update_reference {
        use super::*;

        #[test]
        fn test_right_after_initialization() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp, // should be updated
                // should be updated (elapsed time is greater than decay_period)
                tick_group_index,
                // should be reset
                0,
                0,
            );
        }

        #[test]
        fn test_consecutive_updates() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            // should be updated
            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            let updated_tick_group_index = 6;

            // should be ignored (elapsed time is less than filter_period)
            variables
                .update_reference(updated_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);
        }

        #[test]
        fn test_lt_filter_period() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            // should be updated
            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                tick_group_index,
                0,
                10_000, // +1
            );

            let updated_tick_group_index = 10;
            let updated_current_timestamp = current_timestamp + constants.filter_period as u64 - 1;

            // only last_update_timestamp should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                tick_group_index,
                0,
                10_000,
            );
        }

        #[test]
        fn test_eq_filter_period() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            // should be updated
            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                tick_group_index,
                0,
                10_000, // +1
            );

            let updated_tick_group_index = 10;
            let updated_current_timestamp = current_timestamp + constants.filter_period as u64;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000, // 10_000 * 30% (reduction_factor) = 3_000,
                10_000,
            );
        }

        #[test]
        fn test_gt_filter_period_lt_decay_period() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            // should be updated
            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                tick_group_index,
                0,
                10_000, // +1
            );

            let updated_tick_group_index = 10;
            let updated_current_timestamp = current_timestamp + constants.filter_period as u64 + 1;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000, // 10_000 * 30% (reduction_factor) = 3_000,
                10_000,
            );

            variables
                .update_volatility_accumulator(updated_tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000,
                13_000, // +1
            );

            let updated_tick_group_index = 20;
            let updated_current_timestamp =
                updated_current_timestamp + constants.decay_period as u64 - 1;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_900, // 13_000 * 30% (reduction_factor) = 3_900,
                13_000,
            );
        }

        #[test]
        fn test_eq_decay_period() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            // should be updated
            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                tick_group_index,
                0,
                10_000, // +1
            );

            let updated_tick_group_index = 10;
            let updated_current_timestamp = current_timestamp + constants.filter_period as u64 + 1;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000, // 10_000 * 30% (reduction_factor) = 3_000,
                10_000,
            );

            variables
                .update_volatility_accumulator(updated_tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000,
                13_000, // +1
            );

            let updated_tick_group_index = 20;
            let updated_current_timestamp =
                updated_current_timestamp + constants.decay_period as u64;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                0, // reset
                13_000,
            );

            variables
                .update_volatility_accumulator(updated_tick_group_index, &constants)
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                0,
                0, // reference(0) + delta(0)
            );
        }

        #[test]
        fn test_gt_decay_period() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            // should be updated
            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                tick_group_index,
                0,
                10_000, // +1
            );

            let updated_tick_group_index = 10;
            let updated_current_timestamp = current_timestamp + constants.filter_period as u64 + 1;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000, // 10_000 * 30% (reduction_factor) = 3_000,
                10_000,
            );

            variables
                .update_volatility_accumulator(updated_tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                3_000,
                13_000, // +1
            );

            let updated_tick_group_index = 20;
            let updated_current_timestamp =
                updated_current_timestamp + constants.decay_period as u64 + 1;

            // should be updated
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                0, // reset
                13_000,
            );

            variables
                .update_volatility_accumulator(updated_tick_group_index, &constants)
                .unwrap();
            check_variables(
                &variables,
                updated_current_timestamp,
                updated_tick_group_index,
                0,
                0, // reference(0) + delta(0)
            );
        }
    }

    mod update_volatility_accumulator {
        use super::*;

        #[test]
        fn test_zero_delta() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let tick_group_index = 5;
            let current_timestamp = 1738824616;

            variables
                .update_reference(tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

            // no change on volatility_accumulator
            variables
                .update_volatility_accumulator(tick_group_index, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, tick_group_index, 0, 0);
        }

        #[test]
        fn test_delta_le_max() {
            for delta in 1..36 {
                let constants = constants_for_test();
                let mut variables = AdaptiveFeeVariables::default();

                let tick_group_index = 5;
                let current_timestamp = 1738824616;

                variables
                    .update_reference(tick_group_index, current_timestamp, &constants)
                    .unwrap();
                check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

                variables
                    .update_volatility_accumulator(tick_group_index + delta, &constants)
                    .unwrap();
                let expected_volatility_accumulator =
                    delta as u32 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                check_variables(
                    &variables,
                    current_timestamp,
                    tick_group_index,
                    0,
                    expected_volatility_accumulator,
                );
                assert!(expected_volatility_accumulator <= constants.max_volatility_accumulator);
            }
        }

        #[test]
        fn test_delta_gt_max() {
            for delta in 36..100 {
                let constants = constants_for_test();
                let mut variables = AdaptiveFeeVariables::default();

                let tick_group_index = 5;
                let current_timestamp = 1738824616;

                variables
                    .update_reference(tick_group_index, current_timestamp, &constants)
                    .unwrap();
                check_variables(&variables, current_timestamp, tick_group_index, 0, 0);

                variables
                    .update_volatility_accumulator(tick_group_index + delta, &constants)
                    .unwrap();
                check_variables(
                    &variables,
                    current_timestamp,
                    tick_group_index,
                    0,
                    constants.max_volatility_accumulator, // capped
                );
            }
        }

        #[test]
        fn test_accumulate_small_delta() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            let initial_tick_group_index = 5;
            let initial_current_timestamp = 1738824616;

            let mut tick_group_index = initial_tick_group_index;
            let mut current_timestamp = initial_current_timestamp;
            for nth in 0..100 {
                let expected_volatility_accumulator = constants
                    .max_volatility_accumulator
                    .min(nth as u32 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32);

                variables
                    .update_reference(tick_group_index, current_timestamp, &constants)
                    .unwrap();
                variables
                    .update_volatility_accumulator(tick_group_index, &constants)
                    .unwrap();
                check_variables(
                    &variables,
                    current_timestamp,
                    initial_tick_group_index, // reference should not be updated (< filter_period)
                    0,                        // reference should not be updated
                    expected_volatility_accumulator,
                );

                tick_group_index += 1;
                current_timestamp += 1;
            }
        }
    }
}
