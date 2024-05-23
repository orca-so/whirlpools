use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AccountsType {
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookInput,
    TransferHookIntermediate,
    TransferHookOutput,
    //TickArray,
    //TickArrayOne,
    //TickArrayTwo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,
    pub length: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(Default)]
pub struct ParsedRemainingAccounts<'info> {
    pub transfer_hook_a: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_b: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_reward: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_input: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_intermediate: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_output: Option<Vec<AccountInfo<'info>>>,
    //pub tick_array: Option<Vec<AccountInfo<'info>>>,
    //pub tick_array_one: Option<Vec<AccountInfo<'info>>>,
    //pub tick_array_two: Option<Vec<AccountInfo<'info>>>,
}

pub fn parse_remaining_accounts<'info>(
  remaining_accounts: &[AccountInfo<'info>],
  remaining_accounts_info: &Option<RemainingAccountsInfo>,
  valid_accounts_type_list: &[AccountsType],
) -> Result<ParsedRemainingAccounts<'info>> {
  let mut remaining_accounts_iter = remaining_accounts.iter();
  let mut parsed_remaining_accounts = ParsedRemainingAccounts::default();

  if remaining_accounts_info.is_none() {
    return Ok(parsed_remaining_accounts);
  }

  let remaining_accounts_info = remaining_accounts_info.as_ref().unwrap();

  for slice in remaining_accounts_info.slices.iter() {
    if !valid_accounts_type_list.contains(&slice.accounts_type) {
      return Err(ErrorCode::RemainingAccountsInvalidSlice.into());
    }
    if slice.length == 0 {
      continue;
    }

    let mut accounts: Vec<AccountInfo<'info>> = Vec::with_capacity(slice.length as usize);
    for _ in 0..slice.length {
      if let Some(account) = remaining_accounts_iter.next() {
        accounts.push(account.clone());
      } else {
        return Err(ErrorCode::RemainingAccountsInsufficient.into());
      }
    }

    match slice.accounts_type {
      AccountsType::TransferHookA => {
        if parsed_remaining_accounts.transfer_hook_a.is_some() {
          return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
        }
        parsed_remaining_accounts.transfer_hook_a = Some(accounts);
      }
      AccountsType::TransferHookB => {
        if parsed_remaining_accounts.transfer_hook_b.is_some() {
          return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
        }
        parsed_remaining_accounts.transfer_hook_b = Some(accounts);
      }
      AccountsType::TransferHookReward => {
        if parsed_remaining_accounts.transfer_hook_reward.is_some() {
          return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
        }
        parsed_remaining_accounts.transfer_hook_reward = Some(accounts);
      }
      AccountsType::TransferHookInput => {
        if parsed_remaining_accounts.transfer_hook_input.is_some() {
          return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
        }
        parsed_remaining_accounts.transfer_hook_input = Some(accounts);
      }
      AccountsType::TransferHookIntermediate => {
        if parsed_remaining_accounts.transfer_hook_intermediate.is_some() {
          return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
        }
        parsed_remaining_accounts.transfer_hook_intermediate = Some(accounts);
      }
      AccountsType::TransferHookOutput => {
        if parsed_remaining_accounts.transfer_hook_output.is_some() {
          return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
        }
        parsed_remaining_accounts.transfer_hook_output = Some(accounts);
      }
      /* 
      AccountsType::TickArray => {
        parsed_remaining_accounts.tick_array = Some(accounts);
      }
      AccountsType::TickArrayOne => {
        parsed_remaining_accounts.tick_array_one = Some(accounts);
      }
      AccountsType::TickArrayTwo => {
        parsed_remaining_accounts.tick_array_two = Some(accounts);
      }
      */
    }
  }

  Ok(parsed_remaining_accounts)
}
