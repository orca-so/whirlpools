use pinocchio::pubkey::Pubkey;

use crate::pinocchio::state::whirlpool::oracle::AdaptiveFeeVariablesUpdate;
use crate::state::{AdaptiveFeeConstants, AdaptiveFeeVariables};

//use crate::errors::ErrorCode;
//use crate::math::{increasing_price_order, sqrt_price_from_tick_index, U256Muldiv, Q64_RESOLUTION};
//use crate::state::Whirlpool;
//use anchor_lang::prelude::*;
//use std::cell::{Ref, RefMut};
use super::super::super::{BytesU64};
use super::adaptive_fee::{MemoryMappedAdaptiveFeeConstants, MemoryMappedAdaptiveFeeVariables};

#[derive(Debug)]
#[repr(C)]
pub struct MemoryMappedOracle {
    discriminator: [u8; 8],

    whirlpool: Pubkey,
    trade_enable_timestamp: BytesU64,
    adaptive_fee_constants: MemoryMappedAdaptiveFeeConstants,
    adaptive_fee_variables: MemoryMappedAdaptiveFeeVariables,
    // Reserved for future use
    reserved: [u8; 128],
}
/* 
impl Default for Oracle {
    fn default() -> Self {
        Self {
            whirlpool: Pubkey::default(),
            trade_enable_timestamp: 0,
            adaptive_fee_constants: AdaptiveFeeConstants::default(),
            adaptive_fee_variables: AdaptiveFeeVariables::default(),
            reserved: [0u8; 128],
        }
    }
}
    */

impl MemoryMappedOracle {
  #[inline(always)]
    pub fn whirlpool(&self) -> &Pubkey {
        &self.whirlpool
    }

    #[inline(always)]
    pub fn trade_enable_timestamp(&self) -> u64 {
        u64::from_le_bytes(self.trade_enable_timestamp)
    }

    #[inline(always)]
    pub fn adaptive_fee_constants(&self) -> AdaptiveFeeConstants {
      // TODO: create more pure (POD) AdaptiveFeeConstants (its reserved space is not needed here)
        AdaptiveFeeConstants {
            filter_period: self.adaptive_fee_constants.filter_period(),
            decay_period: self.adaptive_fee_constants.decay_period(),
            reduction_factor: self.adaptive_fee_constants.reduction_factor(),
            adaptive_fee_control_factor: self.adaptive_fee_constants.adaptive_fee_control_factor(),
            max_volatility_accumulator: self.adaptive_fee_constants.max_volatility_accumulator(),
            tick_group_size: self.adaptive_fee_constants.tick_group_size(),
            major_swap_threshold_ticks: self.adaptive_fee_constants.major_swap_threshold_ticks(),
            reserved: [0u8; 16],
        }
    }

    #[inline(always)]
    pub fn adaptive_fee_variables(&self) -> AdaptiveFeeVariables {
        AdaptiveFeeVariables {
            last_reference_update_timestamp: self.adaptive_fee_variables.last_reference_update_timestamp(),
            last_major_swap_timestamp: self.adaptive_fee_variables.last_major_swap_timestamp(),
            volatility_reference: self.adaptive_fee_variables.volatility_reference(),
            tick_group_index_reference: self.adaptive_fee_variables.tick_group_index_reference(),
            volatility_accumulator: self.adaptive_fee_variables.volatility_accumulator(),
            reserved: [0u8; 16],
        }
    }

    pub fn update_adaptive_fee_variables(&mut self, update: &AdaptiveFeeVariables) {
        self.adaptive_fee_variables.update(&update);
    }
}

/* 
#[cfg(test)]
mod discriminator_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_discriminator() {
        let discriminator: [u8; 8] = Oracle::DISCRIMINATOR.try_into().unwrap();
        // The discriminator is determined by the struct name and not depending on the program id.
        // $ echo -n account:Oracle | sha256sum | cut -c 1-16
        // 8bc283b38cb3e5f4
        assert_eq!(
            discriminator,
            [0x8b, 0xc2, 0x83, 0xb3, 0x8c, 0xb3, 0xe5, 0xf4]
        );
    }
}

#[cfg(test)]
mod data_layout_tests {
    use super::*;

    #[test]
    fn test_oracle_data_layout() {
        let oracle_reserved = [0u8; 128];

        let oracle_whirlpool = Pubkey::new_unique();
        let oracle_trade_enable_timestamp = 0x1122334455667788u64;

        let af_const_filter_period = 0x1122u16;
        let af_const_decay_period = 0x3344u16;
        let af_const_reduction_factor = 0x5566u16;
        let af_const_adaptive_fee_control_factor = 0x778899aau32;
        let af_const_max_volatility_accumulator = 0xaabbccddu32;
        let af_const_tick_group_size = 0xeeffu16;
        let af_const_major_swap_threshold_ticks = 0x1122u16;
        let af_const_reserved = [0u8; 16];

        let af_var_last_reference_update_timestamp = 0x1122334455667788u64;
        let af_var_last_major_swap_timestamp = 0x2233445566778899u64;
        let af_var_volatility_reference = 0x99aabbccu32;
        let af_var_tick_group_index_reference = 0x00ddeeffi32;
        let af_var_volatility_accumulator = 0x11223344u32;
        let af_var_reserved = [0u8; 16];

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
        offset += af_const_reserved.len();

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
        offset += af_var_reserved.len();

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
            ..Default::default()
        };

        let af_vars = AdaptiveFeeVariables {
            last_reference_update_timestamp: 0x1122334455667788u64,
            last_major_swap_timestamp: 0x2233445566778899u64,
            volatility_reference: 0x99aabbccu32,
            tick_group_index_reference: 0x00ddeeffi32,
            volatility_accumulator: 0x11223344u32,
            ..Default::default()
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
            ..Default::default()
        };

        let af_vars = AdaptiveFeeVariables {
            last_reference_update_timestamp: 0x1122334455667788u64,
            last_major_swap_timestamp: 0x2233445566778899u64,
            volatility_reference: 0x99aabbccu32,
            tick_group_index_reference: 0x00ddeeffi32,
            volatility_accumulator: 0x11223344u32,
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
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

    mod update_reference_after_initialization {
        use super::*;

        #[test]
        fn test_right_after_initialization() {
            let constants = constants_for_test();
            let mut variables = AdaptiveFeeVariables::default();

            assert!(
                variables.last_reference_update_timestamp == variables.last_major_swap_timestamp
            );

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
    }

    mod update_reference_where_last_reference_is_too_old {
        use super::*;

        #[test]
        fn test_last_reference_is_too_old() {
            let constants = AdaptiveFeeConstants {
                filter_period: 30,
                decay_period: u16::MAX, // too far (> 18 hours)
                reduction_factor: 3000,
                adaptive_fee_control_factor: 4_000,
                max_volatility_accumulator: 350_000,
                tick_group_size: 64,
                major_swap_threshold_ticks: 64,
                ..Default::default()
            };

            let initial = AdaptiveFeeVariables {
                // last_reference_update_timestamp << last_major_swap_timestamp
                last_reference_update_timestamp: 1738824616 - MAX_REFERENCE_AGE,
                last_major_swap_timestamp: 1738824616,
                tick_group_index_reference: 10,
                volatility_accumulator: 30_000,
                volatility_reference: 50_000,
                ..Default::default()
            };

            // elapsed = 0

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp = initial.last_major_swap_timestamp;
            let current_tick_group_index = 5;

            // no update (all fields) (MAX_REFERENCE_AGE is NOT too old)
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                initial.last_reference_update_timestamp,
                initial.last_major_swap_timestamp,
                initial.tick_group_index_reference,
                initial.volatility_reference,
                initial.volatility_accumulator,
            );

            // elapsed = 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp = initial.last_major_swap_timestamp + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
            );
        }
    }

    mod update_reference_where_last_reference_update_eq_last_major_swap {
        use super::*;

        fn initial_variables() -> AdaptiveFeeVariables {
            AdaptiveFeeVariables {
                // last_reference_update_timestamp == last_major_swap_timestamp
                last_reference_update_timestamp: 1738824616,
                last_major_swap_timestamp: 1738824616,
                tick_group_index_reference: 10,
                volatility_accumulator: 30_000,
                volatility_reference: 50_000,
                ..Default::default()
            }
        }

        #[test]
        fn test_lt_filter_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period - 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp == updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.filter_period as u64 - 1;
            let current_tick_group_index = 5;

            // no update (all fields)
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                initial.last_reference_update_timestamp,
                initial.last_major_swap_timestamp,
                initial.tick_group_index_reference,
                initial.volatility_reference,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_eq_filter_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp == updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.filter_period as u64;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_gt_filter_period_lt_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period + 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp == updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.filter_period as u64 + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );

            // elapsed = decay_period - 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp == updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.decay_period as u64 - 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_eq_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = decay_period

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp == updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.decay_period as u64;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_gt_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = decay_period + 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp == updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.decay_period as u64 + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
            );
        }
    }

    mod update_reference_where_last_reference_update_lt_last_major_swap {
        use super::*;

        fn initial_variables() -> AdaptiveFeeVariables {
            AdaptiveFeeVariables {
                // last_reference_update_timestamp < last_major_swap_timestamp
                last_reference_update_timestamp: 1738824616,
                last_major_swap_timestamp: 1738824616 + 1200, // +20 minutes
                tick_group_index_reference: 10,
                volatility_accumulator: 30_000,
                volatility_reference: 50_000,
                ..Default::default()
            }
        }

        #[test]
        fn test_lt_filter_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period - 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_major_swap_timestamp + constants.filter_period as u64 - 1;
            let current_tick_group_index = 5;

            // no update (all fields)
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                initial.last_reference_update_timestamp,
                initial.last_major_swap_timestamp,
                initial.tick_group_index_reference,
                initial.volatility_reference,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_eq_filter_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_major_swap_timestamp + constants.filter_period as u64;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_gt_filter_period_lt_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period + 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_major_swap_timestamp + constants.filter_period as u64 + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );

            // elapsed = decay_period - 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_major_swap_timestamp + constants.decay_period as u64 - 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_eq_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = decay_period

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_major_swap_timestamp + constants.decay_period as u64;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_gt_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = decay_period + 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp < updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_major_swap_timestamp + constants.decay_period as u64 + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
            );
        }
    }

    mod update_reference_where_last_reference_update_gt_last_major_swap {
        use super::*;

        fn initial_variables() -> AdaptiveFeeVariables {
            AdaptiveFeeVariables {
                // last_reference_update_timestamp > last_major_swap_timestamp
                last_reference_update_timestamp: 1738824616 + 1200, // +20 minutes
                last_major_swap_timestamp: 1738824616,
                tick_group_index_reference: 10,
                volatility_accumulator: 30_000,
                volatility_reference: 50_000,
                ..Default::default()
            }
        }

        #[test]
        fn test_lt_filter_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period - 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp > updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.filter_period as u64 - 1;
            let current_tick_group_index = 5;

            // no update (all fields)
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                initial.last_reference_update_timestamp,
                initial.last_major_swap_timestamp,
                initial.tick_group_index_reference,
                initial.volatility_reference,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_eq_filter_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp > updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.filter_period as u64;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_gt_filter_period_lt_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = filter_period + 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp > updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.filter_period as u64 + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );

            // elapsed = decay_period - 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp > updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.decay_period as u64 - 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                initial.volatility_accumulator * constants.reduction_factor as u32
                    / REDUCTION_FACTOR_DENOMINATOR as u32,
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_eq_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = decay_period

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp > updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.decay_period as u64;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
            );
        }

        #[test]
        fn test_gt_decay_period() {
            let constants = constants_for_test();
            let initial = initial_variables();

            // elapsed = decay_period + 1

            let mut updating = initial;
            assert!(updating.last_reference_update_timestamp > updating.last_major_swap_timestamp);
            let current_timestamp =
                initial.last_reference_update_timestamp + constants.decay_period as u64 + 1;
            let current_tick_group_index = 5;

            // should be updated
            updating
                .update_reference(current_tick_group_index, current_timestamp, &constants)
                .unwrap();
            check_variables(
                &updating,
                current_timestamp,
                initial.last_major_swap_timestamp,
                current_tick_group_index,
                0, // reset
                initial.volatility_accumulator,
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
                #[allow(clippy::manual_div_ceil)]
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
                assert!(b_to_a_variables.last_reference_update_timestamp == 0);

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
                assert!(b_to_a_variables.last_reference_update_timestamp == 0);

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
                assert!(a_to_b_variables.last_reference_update_timestamp == 0);

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
                assert!(a_to_b_variables.last_reference_update_timestamp == 0);
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
*/