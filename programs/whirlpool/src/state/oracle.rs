use crate::errors::ErrorCode;
use crate::manager::fee_rate_manager::{
    ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR, MAX_REFERENCE_AGE, REDUCTION_FACTOR_DENOMINATOR,
    VOLATILITY_ACCUMULATOR_SCALE_FACTOR,
};
use crate::math::{sqrt_price_from_tick_index, U256Muldiv, Q64_RESOLUTION};
use crate::state::Whirlpool;
use anchor_lang::prelude::*;
use std::cell::{Ref, RefMut};

use super::TICK_ARRAY_SIZE;

pub const MAX_TRADE_ENABLE_TIMESTAMP_DELTA: u64 = 60 * 60 * 72; // 72 hours

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug, PartialEq, Eq)]
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
    // Major swap threshold in tick
    pub major_swap_threshold_ticks: u16,
}

impl AdaptiveFeeConstants {
    pub const LEN: usize = 2 + 2 + 2 + 4 + 4 + 2 + 2;

    #[allow(clippy::too_many_arguments)]
    pub fn validate_constants(
        tick_spacing: u16,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
        major_swap_threshold_ticks: u16,
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

        // major_swap_threshold_ticks validation
        // there is no clear upper limit for major_swap_threshold_ticks, but as a safeguard, we set the limit to ticks in a TickArray
        let ticks_in_tick_array = tick_spacing as i32 * TICK_ARRAY_SIZE;
        if major_swap_threshold_ticks == 0
            || major_swap_threshold_ticks as i32 > ticks_in_tick_array
        {
            return false;
        }

        true
    }
}

#[zero_copy(unsafe)]
#[repr(C, packed)]
#[derive(Default, Debug, PartialEq, Eq)]
pub struct AdaptiveFeeVariables {
    // Last timestamp (block time) when volatility_reference and tick_group_index_reference were updated
    pub last_reference_update_timestamp: u64,
    // Last timestamp (block time) when major swap was executed
    pub last_major_swap_timestamp: u64,
    // Volatility reference is decayed volatility accumulator
    pub volatility_reference: u32,
    // Active tick group index of last swap
    pub tick_group_index_reference: i32,
    // Volatility accumulator measure the number of tick group crossed since reference tick group index (scaled)
    pub volatility_accumulator: u32,
}

impl AdaptiveFeeVariables {
    pub const LEN: usize = 8 + 8 + 4 + 4 + 4;

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
        let max_timestamp = self
            .last_reference_update_timestamp
            .max(self.last_major_swap_timestamp);
        if current_timestamp < max_timestamp {
            return Err(ErrorCode::InvalidTimestamp.into());
        }

        let reference_age = current_timestamp - self.last_reference_update_timestamp;
        if reference_age > MAX_REFERENCE_AGE {
            // The references are too old, so reset them
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = 0;
            self.last_reference_update_timestamp = current_timestamp;
            return Ok(());
        }

        let elapsed = current_timestamp - max_timestamp;
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
            self.last_reference_update_timestamp = current_timestamp;
        } else {
            // Out of decay time window
            self.tick_group_index_reference = tick_group_index;
            self.volatility_reference = 0;
            self.last_reference_update_timestamp = current_timestamp;
        }

        Ok(())
    }

    pub fn update_major_swap_timestamp(
        &mut self,
        pre_sqrt_price: u128,
        post_sqrt_price: u128,
        current_timestamp: u64,
        adaptive_fee_constants: &AdaptiveFeeConstants,
    ) -> Result<()> {
        if Self::is_major_swap(
            pre_sqrt_price,
            post_sqrt_price,
            adaptive_fee_constants.major_swap_threshold_ticks,
        )? {
            self.last_major_swap_timestamp = current_timestamp;
        }
        Ok(())
    }

    // Determine whether the difference between pre_sqrt_price and post_sqrt_price is equivalent to major_swap_threshold_ticks or more
    // Note: The error of less than 0.00000003% due to integer arithmetic of sqrt_price is acceptable
    fn is_major_swap(
        pre_sqrt_price: u128,
        post_sqrt_price: u128,
        major_swap_threshold_ticks: u16,
    ) -> Result<bool> {
        let (smaller_sqrt_price, larger_sqrt_price) = if pre_sqrt_price < post_sqrt_price {
            (pre_sqrt_price, post_sqrt_price)
        } else {
            (post_sqrt_price, pre_sqrt_price)
        };

        // major_swap_sqrt_price_target
        //   = smaller_sqrt_price * pow(1.0001, major_swap_threshold_ticks)
        //   = smaller_sqrt_price * sqrt_price_from_tick_index(major_swap_threshold_ticks) >> Q64_RESOLUTION
        //
        // Note: The following two are theoretically equal, but there is an integer arithmetic error.
        //       However, the error impact is less than 0.00000003% in sqrt price (x64) and is small enough.
        //       - sqrt_price_from_tick_index(a) * sqrt_price_from_tick_index(b)   (mathematically, pow(1.0001, a) * pow(1.0001, b) = pow(1.0001, a + b))
        //       - sqrt_price_from_tick_index(a + b)                               (mathematically, pow(1.0001, a + b))
        let major_swap_sqrt_price_factor =
            sqrt_price_from_tick_index(major_swap_threshold_ticks as i32);
        let major_swap_sqrt_price_target = U256Muldiv::new(0, smaller_sqrt_price)
            .mul(U256Muldiv::new(0, major_swap_sqrt_price_factor))
            .shift_right(Q64_RESOLUTION as u32)
            .try_into_u128()?;

        Ok(larger_sqrt_price >= major_swap_sqrt_price_target)
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
        major_swap_threshold_ticks: u16,
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
            major_swap_threshold_ticks,
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
            constants.major_swap_threshold_ticks,
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
    pub fn new(
        whirlpool: &Account<'info, Whirlpool>,
        oracle_account_info: AccountInfo<'info>,
    ) -> Result<Self> {
        let oracle_account_initialized =
            Self::is_oracle_account_initialized(&oracle_account_info, whirlpool.key())?;
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

    fn is_oracle_account_initialized(
        oracle_account_info: &AccountInfo<'info>,
        whirlpool: Pubkey,
    ) -> Result<bool> {
        use anchor_lang::Discriminator;

        // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut
        // AccountLoader can handle initialized account and partially initialized (owner program changed) account only.
        // So we need to handle uninitialized account manually.

        // Note: intentionally do not check if the account is writable here, defer the evaluation until load_mut is called

        // uninitialized account (owned by system program and its data size is zero)
        if oracle_account_info.owner == &System::id() && oracle_account_info.data_is_empty() {
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

        // whirlpool check
        let oracle_ref: Ref<Oracle> = Ref::map(data, |data| {
            bytemuck::from_bytes(&data[8..std::mem::size_of::<Oracle>() + 8])
        });
        if oracle_ref.whirlpool != whirlpool {
            // Just for safety: Oracle address is derived from Whirlpool address, so this should not happen.
            unreachable!();
        }

        Ok(true)
    }

    fn load(&self) -> Result<Ref<'_, Oracle>> {
        // is_oracle_account_initialized already checked if the account is initialized

        let data = self.oracle_account_info.try_borrow_data()?;
        let oracle_ref: Ref<Oracle> = Ref::map(data, |data| {
            bytemuck::from_bytes(&data[8..std::mem::size_of::<Oracle>() + 8])
        });

        Ok(oracle_ref)
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
        let af_const_major_swap_threshold_ticks = 0x1122u16;

        let af_var_last_reference_update_timestamp = 0x1122334455667788u64;
        let af_var_last_major_swap_timestamp = 0x2233445566778899u64;
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
        af_const_data[offset..offset + 2]
            .copy_from_slice(&af_const_major_swap_threshold_ticks.to_le_bytes());
        offset += 2;

        assert_eq!(offset, af_const_data.len());

        // manually build the expected AdaptiveFeeVariables data layout
        let mut af_var_data = [0u8; AdaptiveFeeVariables::LEN];
        let mut offset = 0;
        af_var_data[offset..offset + 8]
            .copy_from_slice(&af_var_last_reference_update_timestamp.to_le_bytes());
        offset += 8;
        af_var_data[offset..offset + 8]
            .copy_from_slice(&af_var_last_major_swap_timestamp.to_le_bytes());
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
        oracle_data[offset..offset + 8]
            .copy_from_slice(&oracle_trade_enable_timestamp.to_le_bytes());
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
        let read_af_const_major_swap_threshold_ticks =
            oracle.adaptive_fee_constants.major_swap_threshold_ticks;
        assert_eq!(
            read_af_const_major_swap_threshold_ticks,
            af_const_major_swap_threshold_ticks
        );

        let read_af_var_last_reference_update_timestamp = oracle
            .adaptive_fee_variables
            .last_reference_update_timestamp;
        assert_eq!(
            read_af_var_last_reference_update_timestamp,
            af_var_last_reference_update_timestamp
        );
        let read_af_var_last_major_swap_timestamp =
            oracle.adaptive_fee_variables.last_major_swap_timestamp;
        assert_eq!(
            read_af_var_last_major_swap_timestamp,
            af_var_last_major_swap_timestamp
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
mod oracle_accessor_test {
    use std::u64;

    use super::*;
    use crate::util::test_utils::account_info_mock::AccountInfoMock;

    #[test]
    fn new_with_uninitialized_oracle_account_not_writable() {
        let is_writable = false;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(is_writable);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_ok());
        assert!(!result.unwrap().oracle_account_initialized);
    }

    #[test]
    fn new_with_uninitialized_oracle_account_writable() {
        let is_writable = true;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(is_writable);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_ok());
        assert!(!result.unwrap().oracle_account_initialized);
    }

    #[test]
    fn new_with_initialized_oracle_account_not_writable() {
        let is_writable = false;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(is_writable);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_ok());
        assert!(result.unwrap().oracle_account_initialized);
    }

    #[test]
    fn new_with_initialized_oracle_account_writable() {
        let is_writable = true;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(is_writable);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_ok());
        assert!(result.unwrap().oracle_account_initialized);
    }

    #[test]
    fn fail_new_wrong_owner_program() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let wrong_owner_program = Some(Pubkey::new_unique());

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            wrong_owner_program,
        );
        let account_info = account_info_mock.to_account_info(true);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("AccountOwnedByWrongProgram"));
    }

    #[test]
    fn fail_new_discriminator_not_found() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        // 7 bytes is too short to contain the discriminator
        let mut account_info_mock =
            AccountInfoMock::new(account_address, vec![0u8; 7], Oracle::owner());
        let account_info = account_info_mock.to_account_info(true);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("AccountDiscriminatorNotFound"));
    }

    #[test]
    fn fail_new_discriminator_mismatch() {
        let is_writable = false;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new(account_address, vec![0u8; Oracle::LEN], Oracle::owner());
        let account_info = account_info_mock.to_account_info(is_writable);

        let result = OracleAccessor::new(&whirlpool, account_info);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("AccountDiscriminatorMismatch"));
    }

    #[test]
    #[should_panic]
    fn panic_new_whirlpool_mismatch() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let fake_whirlpool_address = Pubkey::new_unique();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            fake_whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(true);

        let _result = OracleAccessor::new(&whirlpool, account_info);
    }

    #[test]
    fn is_trade_enabled_with_initialized_oracle_account() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let trade_enable_timestamp = 1741238139u64;

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            trade_enable_timestamp,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        assert!(accessor.oracle_account_initialized);

        // not tradable
        assert!(!accessor.is_trade_enabled(0).unwrap());
        assert!(!accessor
            .is_trade_enabled(trade_enable_timestamp / 2)
            .unwrap());
        assert!(!accessor
            .is_trade_enabled(trade_enable_timestamp - 10)
            .unwrap());
        assert!(!accessor
            .is_trade_enabled(trade_enable_timestamp - 2)
            .unwrap());
        assert!(!accessor
            .is_trade_enabled(trade_enable_timestamp - 1)
            .unwrap());
        // tradable
        assert!(accessor.is_trade_enabled(trade_enable_timestamp).unwrap());
        assert!(accessor
            .is_trade_enabled(trade_enable_timestamp + 1)
            .unwrap());
        assert!(accessor
            .is_trade_enabled(trade_enable_timestamp + 2)
            .unwrap());
        assert!(accessor
            .is_trade_enabled(trade_enable_timestamp + 10)
            .unwrap());
        assert!(accessor
            .is_trade_enabled(trade_enable_timestamp * 2)
            .unwrap());
        assert!(accessor.is_trade_enabled(u64::MAX).unwrap());
    }

    #[test]
    fn is_trade_enabled_with_uninitialized_oracle_account() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        assert!(!accessor.oracle_account_initialized);

        let current_timestamp = 1741238139u64;

        // always tradable
        assert!(accessor.is_trade_enabled(0).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp / 2).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp - 10).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp - 2).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp - 1).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp + 1).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp + 2).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp + 10).unwrap());
        assert!(accessor.is_trade_enabled(current_timestamp * 2).unwrap());
        assert!(accessor.is_trade_enabled(u64::MAX).unwrap());
    }

    #[test]
    fn get_adaptive_fee_info_with_initialized_oracle_account() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let af_consts = AdaptiveFeeConstants {
            filter_period: 0x7777,
            decay_period: 0xffff,
            reduction_factor: 0x9999,
            adaptive_fee_control_factor: 0x33333333,
            max_volatility_accumulator: 0x55555555,
            tick_group_size: 256,
            major_swap_threshold_ticks: 128,
        };

        let af_vars = AdaptiveFeeVariables {
            last_reference_update_timestamp: 0x1122334455667788u64,
            last_major_swap_timestamp: 0x2233445566778899u64,
            volatility_reference: 0x99aabbccu32,
            tick_group_index_reference: 0x00ddeeffi32,
            volatility_accumulator: 0x11223344u32,
        };

        let account_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_oracle(account_address, whirlpool_address, 100, af_consts, None);
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        assert!(accessor.oracle_account_initialized);

        let adaptive_fee_info = accessor.get_adaptive_fee_info();
        assert!(adaptive_fee_info.is_ok());
        let adaptive_fee_info = adaptive_fee_info.unwrap();
        assert!(adaptive_fee_info.is_some());
        let adaptive_fee_info = adaptive_fee_info.unwrap();

        assert_eq!(adaptive_fee_info.constants, af_consts);
        assert_eq!(adaptive_fee_info.variables, AdaptiveFeeVariables::default());

        accessor
            .update_adaptive_fee_variables(&Some(AdaptiveFeeInfo {
                constants: af_consts,
                variables: af_vars,
            }))
            .unwrap();

        let adaptive_fee_info = accessor.get_adaptive_fee_info();
        assert!(adaptive_fee_info.is_ok());
        let adaptive_fee_info = adaptive_fee_info.unwrap();
        assert!(adaptive_fee_info.is_some());
        let adaptive_fee_info = adaptive_fee_info.unwrap();

        assert_eq!(adaptive_fee_info.constants, af_consts);
        assert_eq!(adaptive_fee_info.variables, af_vars);
    }

    #[test]
    fn get_adaptive_fee_info_with_uninitialized_oracle_account() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        assert!(!accessor.oracle_account_initialized);

        let adaptive_fee_info = accessor.get_adaptive_fee_info();
        assert!(adaptive_fee_info.is_ok());
        let adaptive_fee_info = adaptive_fee_info.unwrap();
        assert!(adaptive_fee_info.is_none());
    }

    #[test]
    fn update_adaptive_fee_variables_some_initialized() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        let af_consts = AdaptiveFeeConstants {
            filter_period: 0x7777,
            decay_period: 0xffff,
            reduction_factor: 0x9999,
            adaptive_fee_control_factor: 0x33333333,
            max_volatility_accumulator: 0x55555555,
            tick_group_size: 256,
            major_swap_threshold_ticks: 128,
        };

        let af_vars = AdaptiveFeeVariables {
            last_reference_update_timestamp: 0x1122334455667788u64,
            last_major_swap_timestamp: 0x2233445566778899u64,
            volatility_reference: 0x99aabbccu32,
            tick_group_index_reference: 0x00ddeeffi32,
            volatility_accumulator: 0x11223344u32,
        };

        let adaptive_fee_info = AdaptiveFeeInfo {
            constants: af_consts,
            variables: af_vars,
        };

        accessor
            .update_adaptive_fee_variables(&Some(adaptive_fee_info))
            .unwrap();

        let adaptive_fee_info = accessor.get_adaptive_fee_info().unwrap().unwrap();
        // constants should not be updated
        assert_eq!(adaptive_fee_info.constants, AdaptiveFeeConstants::default());
        // variables should be updated
        assert_eq!(adaptive_fee_info.variables, af_vars);
    }

    #[test]
    #[should_panic]
    fn panic_update_adaptive_fee_variables_none_initialized() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        let _result = accessor.update_adaptive_fee_variables(&None);
    }

    #[test]
    #[should_panic]
    fn panic_update_adaptive_fee_variables_some_uninitialized() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        let adaptive_fee_info = AdaptiveFeeInfo {
            constants: AdaptiveFeeConstants::default(),
            variables: AdaptiveFeeVariables::default(),
        };

        let _result = accessor.update_adaptive_fee_variables(&Some(adaptive_fee_info));
    }

    #[test]
    fn update_adaptive_fee_variables_none_uninitialized() {
        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(true);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        accessor.update_adaptive_fee_variables(&None).unwrap();
    }

    #[test]
    fn fail_update_adaptive_fee_variables_some_initialized_but_not_writable() {
        let is_writable = false;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new_oracle(
            account_address,
            whirlpool_address,
            100,
            AdaptiveFeeConstants::default(),
            None,
        );
        let account_info = account_info_mock.to_account_info(is_writable);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        let adaptive_fee_info = AdaptiveFeeInfo {
            constants: AdaptiveFeeConstants::default(),
            variables: AdaptiveFeeVariables::default(),
        };

        let result = accessor.update_adaptive_fee_variables(&Some(adaptive_fee_info));
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("AccountNotMutable"));
    }

    #[test]
    fn update_adaptive_fee_variables_none_uninitialized_but_not_writable() {
        let is_writable = false;

        let whirlpool_address = Pubkey::new_unique();
        let mut account_info_mock =
            AccountInfoMock::new_whirlpool(whirlpool_address, 64, 5650, None);
        let account_info = account_info_mock.to_account_info(false);
        let whirlpool = Account::<Whirlpool>::try_from(&account_info).unwrap();

        let account_address = Pubkey::new_unique();
        let mut account_info_mock = AccountInfoMock::new(account_address, vec![], System::id());
        let account_info = account_info_mock.to_account_info(is_writable);
        let result = OracleAccessor::new(&whirlpool, account_info);
        let accessor = result.unwrap();

        // should work even if the account is not writable
        accessor.update_adaptive_fee_variables(&None).unwrap();
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
        let major_swap_threshold_ticks = 0x0080u16;

        let constants = AdaptiveFeeConstants {
            filter_period,
            decay_period,
            reduction_factor,
            adaptive_fee_control_factor,
            max_volatility_accumulator,
            tick_group_size,
            major_swap_threshold_ticks,
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
        let read_af_const_major_swap_threshold_ticks =
            oracle.adaptive_fee_constants.major_swap_threshold_ticks;
        assert_eq!(
            read_af_const_major_swap_threshold_ticks,
            major_swap_threshold_ticks
        );
    }

    #[test]
    fn test_update_adaptive_fee_variables() {
        let mut oracle = Oracle::default();

        let last_reference_update_timestamp = 0x1122334455667788u64;
        let last_major_swap_timestamp = 0x2233445566778899u64;
        let volatility_reference = 0x99aabbccu32;
        let tick_group_index_reference = 0x00ddeeffi32;
        let volatility_accumulator = 0x11223344u32;

        let variables = AdaptiveFeeVariables {
            last_reference_update_timestamp,
            last_major_swap_timestamp,
            volatility_reference,
            tick_group_index_reference,
            volatility_accumulator,
        };

        oracle.update_adaptive_fee_variables(variables);

        let read_af_var_last_reference_update_timestamp = oracle
            .adaptive_fee_variables
            .last_reference_update_timestamp;
        assert_eq!(
            read_af_var_last_reference_update_timestamp,
            last_reference_update_timestamp
        );
        let read_af_var_last_major_swap_timestamp =
            oracle.adaptive_fee_variables.last_major_swap_timestamp;
        assert_eq!(
            read_af_var_last_major_swap_timestamp,
            last_major_swap_timestamp
        );
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
            major_swap_threshold_ticks: 64,
        }
    }

    fn check_variables(
        variables: &AdaptiveFeeVariables,
        last_reference_update_timestamp: u64,
        last_major_swap_timestamp: u64,
        tick_group_index_reference: i32,
        volatility_reference: u32,
        volatility_accumulator: u32,
    ) {
        let read_last_reference_update_timestamp = variables.last_reference_update_timestamp;
        assert_eq!(
            read_last_reference_update_timestamp,
            last_reference_update_timestamp
        );
        let read_last_major_swap_timestamp = variables.last_major_swap_timestamp;
        assert_eq!(read_last_major_swap_timestamp, last_major_swap_timestamp);
        let read_tick_group_index_reference = variables.tick_group_index_reference;
        assert_eq!(read_tick_group_index_reference, tick_group_index_reference);
        let read_volatility_reference = variables.volatility_reference;
        assert_eq!(read_volatility_reference, volatility_reference);
        let read_volatility_accumulator = variables.volatility_accumulator;
        assert_eq!(read_volatility_accumulator, volatility_accumulator);
    }

    mod update_reference_swap_timestamp_0 {
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
                0,                 // should not be updated
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            let updated_tick_group_index = 6;

            // should be ignored (elapsed time is less than filter_period)
            variables
                .update_reference(updated_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                0,
                tick_group_index,
                0,
                10_000, // +1
            );

            let updated_tick_group_index = 10;
            let updated_current_timestamp = current_timestamp + constants.filter_period as u64 - 1;

            // no update (reference is not updated)
            variables
                .update_reference(
                    updated_tick_group_index,
                    updated_current_timestamp,
                    &constants,
                )
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                0,
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                0,
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
                0,
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                0,
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
                0,
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
                0,
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
                0,
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                0,
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
                0,
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
                0,
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
                0,
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
                0,
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            variables
                .update_volatility_accumulator(tick_group_index + 1, &constants)
                .unwrap();
            check_variables(
                &variables,
                current_timestamp,
                0,
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
                0,
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
                0,
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
                0,
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
                0,
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
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

            // no change on volatility_accumulator
            variables
                .update_volatility_accumulator(tick_group_index, &constants)
                .unwrap();
            check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);
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
                check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

                variables
                    .update_volatility_accumulator(tick_group_index + delta, &constants)
                    .unwrap();
                let expected_volatility_accumulator =
                    delta as u32 * VOLATILITY_ACCUMULATOR_SCALE_FACTOR as u32;
                check_variables(
                    &variables,
                    current_timestamp,
                    0,
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
                check_variables(&variables, current_timestamp, 0, tick_group_index, 0, 0);

                variables
                    .update_volatility_accumulator(tick_group_index + delta, &constants)
                    .unwrap();
                check_variables(
                    &variables,
                    current_timestamp,
                    0,
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

            for nth in 0..constants.filter_period {
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
                    initial_current_timestamp, // reference should not be updated (< filter_period)
                    0,                         // reference should not be updated (no major swap)
                    initial_tick_group_index,  // reference should not be updated (< filter_period)
                    0,                         // reference should not be updated
                    expected_volatility_accumulator,
                );

                tick_group_index += 1;
                current_timestamp += 1;
            }
        }
    }

    mod update_major_swap_timestamp {
        use super::*;
        use crate::state::{MAX_TICK_INDEX, MIN_TICK_INDEX};

        fn test(major_swap_threshold_ticks: u16) {
            let current_timestamp = 1738824616;
            let constants = AdaptiveFeeConstants {
                major_swap_threshold_ticks,
                ..constants_for_test()
            };

            let step = 256;
            let min_tick_index = MIN_TICK_INDEX / step * step;
            let max_tick_index = MAX_TICK_INDEX / step * step;

            for smaller_tick_index in (min_tick_index..=max_tick_index).step_by(step as usize) {
                let larger_tick_index = smaller_tick_index + major_swap_threshold_ticks as i32;
                if larger_tick_index > MAX_TICK_INDEX {
                    break;
                }

                let smaller_sqrt_price = sqrt_price_from_tick_index(smaller_tick_index);
                let larger_sqrt_price = sqrt_price_from_tick_index(larger_tick_index);

                // tolerance is 0.00000003% of larger_sqrt_price
                // ceil(large_sqrt_price * 0.00000003%)
                let epsilon = (larger_sqrt_price * 3 + (10000000000 - 1)) / 10000000000;

                // is_major_swap test

                let b_to_a_is_major_swap_sub_epsilon = AdaptiveFeeVariables::is_major_swap(
                    smaller_sqrt_price,
                    larger_sqrt_price - epsilon,
                    major_swap_threshold_ticks,
                )
                .unwrap();
                let b_to_a_is_major_swap_add_epsilon = AdaptiveFeeVariables::is_major_swap(
                    smaller_sqrt_price,
                    larger_sqrt_price + epsilon,
                    major_swap_threshold_ticks,
                )
                .unwrap();
                // println!("tick_index: {}/{}, large_sqrt_price: {}, epsilon: {}, -/+: {}/{}", smaller_tick_index, larger_tick_index, larger_sqrt_price, epsilon, b_to_a_is_major_swap_sub_epsilon, b_to_a_is_major_swap_add_epsilon);
                assert!(!b_to_a_is_major_swap_sub_epsilon);
                assert!(b_to_a_is_major_swap_add_epsilon);

                let a_to_b_is_major_swap_sub_epsilon = AdaptiveFeeVariables::is_major_swap(
                    larger_sqrt_price,
                    smaller_sqrt_price - epsilon,
                    major_swap_threshold_ticks,
                )
                .unwrap();
                let a_to_b_is_major_swap_add_epsilon = AdaptiveFeeVariables::is_major_swap(
                    larger_sqrt_price,
                    smaller_sqrt_price + epsilon,
                    major_swap_threshold_ticks,
                )
                .unwrap();
                assert!(a_to_b_is_major_swap_sub_epsilon);
                assert!(!a_to_b_is_major_swap_add_epsilon);

                // update_major_swap_timestamp test

                let mut b_to_a_variables = AdaptiveFeeVariables::default();
                // should not be updated
                b_to_a_variables
                    .update_major_swap_timestamp(
                        smaller_sqrt_price,
                        larger_sqrt_price - epsilon,
                        current_timestamp,
                        &constants,
                    )
                    .unwrap();
                assert!(b_to_a_variables.last_major_swap_timestamp == 0);

                // should be updated
                b_to_a_variables
                    .update_major_swap_timestamp(
                        smaller_sqrt_price,
                        larger_sqrt_price + epsilon,
                        current_timestamp,
                        &constants,
                    )
                    .unwrap();
                assert!(b_to_a_variables.last_major_swap_timestamp == current_timestamp);

                let mut a_to_b_variables = AdaptiveFeeVariables::default();
                // should not be updated
                a_to_b_variables
                    .update_major_swap_timestamp(
                        larger_sqrt_price,
                        smaller_sqrt_price + epsilon,
                        current_timestamp,
                        &constants,
                    )
                    .unwrap();
                assert!(a_to_b_variables.last_major_swap_timestamp == 0);

                // should be updated
                a_to_b_variables
                    .update_major_swap_timestamp(
                        larger_sqrt_price,
                        smaller_sqrt_price - epsilon,
                        current_timestamp,
                        &constants,
                    )
                    .unwrap();
                assert!(a_to_b_variables.last_major_swap_timestamp == current_timestamp);
            }
        }

        #[test]
        fn test_major_swap_threshold_ticks_1() {
            test(1);
        }

        #[test]
        fn test_major_swap_threshold_ticks_8() {
            test(8);
        }

        #[test]
        fn test_major_swap_threshold_ticks_64() {
            test(64);
        }

        #[test]
        fn test_major_swap_threshold_ticks_128() {
            test(128);
        }

        #[test]
        fn test_major_swap_threshold_ticks_512() {
            test(512);
        }
    }
}
