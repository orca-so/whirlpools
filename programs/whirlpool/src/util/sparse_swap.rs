use std::{cell::{Ref, RefCell, RefMut}, collections::VecDeque};
use anchor_lang::prelude::*;

use crate::{
    errors::ErrorCode,
    state::{TickArray, Whirlpool, MAX_TICK_INDEX, MIN_TICK_INDEX, TICK_ARRAY_SIZE},
    util::SwapTickSequence,
};

enum TickArrayAccount<'info> {
  // owned by this whirlpool program and its discriminator is valid and writable
  // but not sure if this TickArray is valid for this whirlpool (maybe for another whirlpool)
  Initialized(Pubkey, i32, AccountInfo<'info>),
  // owned by system program and its data size is zero and writable
  // but not sure if this key is valid PDA for TickArray
  Uninitialized(Pubkey, AccountInfo<'info>, Option<Box<RefCell<TickArray>>>),
}

pub struct SparseSwapTickSequenceBuilder<'info> {
  tick_array_accounts: Vec<TickArrayAccount<'info>>,
}

impl<'info> SparseSwapTickSequenceBuilder<'info> {
  pub fn try_from(
      whirlpool: Box<Account<'info, Whirlpool>>,
      a_to_b: bool,
      mut tick_array_account_infos: Vec<AccountInfo<'info>>,
  ) -> Result<Self> {
      // dedup by key
      tick_array_account_infos.sort_by_key(|a| a.key());
      tick_array_account_infos.dedup_by_key(|a| a.key());

      let mut initialized = vec![];
      let mut uninitialized = vec![];
      for account_info in tick_array_account_infos.into_iter() {
          let state = peek_tick_array(account_info)?;

          match &state {
              TickArrayAccount::Initialized(tick_array_whirlpool, start_tick_index, ..) => {
                  // has_one constraint equivalent check
                  if *tick_array_whirlpool != whirlpool.key() {
                      // TODO: our own error definition
                      return Err(anchor_lang::error::ErrorCode::ConstraintHasOne.into());
                  }
                  initialized.push((*start_tick_index, state));
              }
              TickArrayAccount::Uninitialized(pubkey, ..) => {
                  uninitialized.push((*pubkey, state));
              }
          }
      }
  
      ////////////////////////////////////////////////////////////////////////
      // Now successfully loaded tick arrays have been verified as:
      // - Owned by Whirlpool Program
      // - Initialized as TickArray account
      // - And has_one constraint is satisfied (i.e. belongs to trading whirlpool)
      // - Writable
      ////////////////////////////////////////////////////////////////////////
      let start_tick_indexes = get_start_tick_indexes(&whirlpool, a_to_b);
  
      let mut tick_array_accounts: Vec<TickArrayAccount> = vec![];
      for start_tick_index in start_tick_indexes.iter() {
          // find from initialized tick arrays
          if let Some(pos) = initialized.iter().position(|t| t.0 == *start_tick_index) {
              let state = initialized.remove(pos).1;
              tick_array_accounts.push(state);
              continue;
          }
  
          // find from uninitialized tick arrays
          let tick_array_pda = derive_tick_array_pda(&whirlpool, *start_tick_index);
          if let Some(pos) = uninitialized.iter().position(|t| t.0 == tick_array_pda) {
              let state = uninitialized.remove(pos).1;
              if let TickArrayAccount::Uninitialized(pubkey, account_info, ..) = state {
                  // create zeroed TickArray data
                  let zeroed = Box::new(RefCell::new(TickArray::default()));
                  zeroed.borrow_mut().initialize(&whirlpool, *start_tick_index)?;

                  tick_array_accounts.push(TickArrayAccount::Uninitialized(
                      pubkey,
                      account_info,
                      Some(zeroed)
                  ));
              } else {
                  unreachable!("state in uninitialized must be Uninitialized");
              }
              continue;
          }
  
          // no more valid tickarrays for this swap
          break;
      }

      Ok(Self { tick_array_accounts })
  }

  pub fn build<'a>(&'a self) -> Result<SwapTickSequence<'a>> {
      let mut tick_array_refmuts = VecDeque::with_capacity(3);
      for tick_array_account in self.tick_array_accounts.iter() {
          match tick_array_account {
              TickArrayAccount::Initialized(_, _, account_info) => {
                  use std::ops::DerefMut;

                  let data = account_info.try_borrow_mut_data()?;
                  let tick_array_refmut = RefMut::map(data, |data| {
                      bytemuck::from_bytes_mut(&mut data.deref_mut()[8..std::mem::size_of::<TickArray>() + 8])
                  });
                  tick_array_refmuts.push_back(tick_array_refmut);
              }
              TickArrayAccount::Uninitialized(_, _, tick_array) => {
                  let tick_array_refmut = tick_array.as_ref().unwrap().borrow_mut();
                  tick_array_refmuts.push_back(tick_array_refmut);
              }
          }
      }
      
      if tick_array_refmuts.is_empty() {
          return Err(crate::errors::ErrorCode::InvalidTickArraySequence.into());
      }
  
      Ok(SwapTickSequence::<'a>::new(
          tick_array_refmuts.pop_front().unwrap(),
          tick_array_refmuts.pop_front(),
          tick_array_refmuts.pop_front(),
      ))    
  }
}

fn peek_tick_array<'info>(
  account_info: AccountInfo<'info>,
) -> Result<TickArrayAccount<'info>> {
  use anchor_lang::Discriminator;

  // following process is ported from anchor-lang's AccountLoader::try_from and AccountLoader::load_mut

  if !account_info.is_writable {
      return Err(anchor_lang::error::ErrorCode::AccountNotMutable.into());
  }

  // uninitialized writable account (owned by system program and its data size is zero)
  if account_info.owner == &System::id() && account_info.data_is_empty() {
      return Ok(TickArrayAccount::Uninitialized(*account_info.key, account_info, None));
  }

  // owner program check
  if account_info.owner != &TickArray::owner() {
      return Err(Error::from(anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram)
          .with_pubkeys((*account_info.owner, TickArray::owner())));
  }

  let data = account_info.try_borrow_data()?;
  if data.len() < TickArray::discriminator().len() {
      return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
  }

  let disc_bytes = arrayref::array_ref![data, 0, 8];
  if disc_bytes != &TickArray::discriminator() {
      return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
  }

  let tick_array: Ref<TickArray> = Ref::map(data, |data| {
      bytemuck::from_bytes(&data[8..std::mem::size_of::<TickArray>() + 8])
  });

  let start_tick_index = tick_array.start_tick_index;
  let whirlpool = tick_array.whirlpool;
  drop(tick_array);

  Ok(TickArrayAccount::Initialized(whirlpool, start_tick_index, account_info))
}

fn get_start_tick_indexes(whirlpool: &Account<Whirlpool>, a_to_b: bool) -> Vec<i32> {
  let tick_current_index = whirlpool.tick_current_index;
  let tick_spacing = whirlpool.tick_spacing as i32;
  let ticks_in_array = TICK_ARRAY_SIZE * tick_spacing;

  let start_tick_index_base = floor_division(tick_current_index, ticks_in_array) * ticks_in_array;
  let offset = if a_to_b {
      [0, -1, -2]
  } else {
      let shifted = tick_current_index + tick_spacing >= start_tick_index_base + ticks_in_array;
      if shifted { [1, 2, 3] } else { [0, 1, 2] }
  };

  let start_tick_indexes = offset
      .iter()
      .filter_map(|&o| {
          let start_tick_index = start_tick_index_base + o * ticks_in_array;
          if is_valid_start_tick_index(start_tick_index, ticks_in_array) {
              Some(start_tick_index)
          } else {
              None
          }
      })
      .collect::<Vec<i32>>();

  start_tick_indexes
}

fn is_valid_start_tick_index(start_tick_index: i32, ticks_in_array: i32) -> bool {
  start_tick_index + ticks_in_array > MIN_TICK_INDEX && start_tick_index < MAX_TICK_INDEX
}

fn floor_division(dividend: i32, divisor: i32) -> i32 {
  assert!(divisor != 0, "Divisor cannot be zero.");
  if dividend % divisor == 0 || dividend.signum() == divisor.signum() {
      dividend / divisor
  } else {
      dividend / divisor - 1
  }
}

fn derive_tick_array_pda(
  whirlpool: &Account<Whirlpool>,
  start_tick_index: i32,
) -> Pubkey {
  Pubkey::find_program_address(
      &[
          b"tick_array",
          whirlpool.key().as_ref(),
          start_tick_index.to_string().as_bytes(),
      ],
      &TickArray::owner()
  ).0
}
