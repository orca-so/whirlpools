use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AccountsType {
    TickArray,
    TickArrayOne,
    TickArrayTwo,
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookOneA,
    TransferHookOneB,
    TransferHookTwoA,
    TransferHookTwoB,
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
    pub tick_array: Option<Vec<AccountInfo<'info>>>,
    pub tick_array_one: Option<Vec<AccountInfo<'info>>>,
    pub tick_array_two: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_a: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_b: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_reward: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_one_a: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_one_b: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_two_a: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_two_b: Option<Vec<AccountInfo<'info>>>,
}

pub fn parse_remaining_accounts<'info>(
  remaining_accounts: &[AccountInfo<'info>],
  remaining_accounts_info: &RemainingAccountsInfo,
  valid_accounts_type_list: &[AccountsType],
) -> Result<ParsedRemainingAccounts<'info>> {
  let mut remaining_accounts_iter = remaining_accounts.iter();
  let mut parsed_remaining_accounts = ParsedRemainingAccounts::default();

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
      AccountsType::TickArray => {
        parsed_remaining_accounts.tick_array = Some(accounts);
      }
      AccountsType::TickArrayOne => {
        parsed_remaining_accounts.tick_array_one = Some(accounts);
      }
      AccountsType::TickArrayTwo => {
        parsed_remaining_accounts.tick_array_two = Some(accounts);
      }
      AccountsType::TransferHookA => {
        parsed_remaining_accounts.transfer_hook_a = Some(accounts);
      }
      AccountsType::TransferHookB => {
        parsed_remaining_accounts.transfer_hook_b = Some(accounts);
      }
      AccountsType::TransferHookReward => {
        parsed_remaining_accounts.transfer_hook_reward = Some(accounts);
      }
      AccountsType::TransferHookOneA => {
        parsed_remaining_accounts.transfer_hook_one_a = Some(accounts);
      }
      AccountsType::TransferHookOneB => {
        parsed_remaining_accounts.transfer_hook_one_b = Some(accounts);
      }
      AccountsType::TransferHookTwoA => {
        parsed_remaining_accounts.transfer_hook_two_a = Some(accounts);
      }
      AccountsType::TransferHookTwoB => {
        parsed_remaining_accounts.transfer_hook_two_b = Some(accounts);
      }
    }
  }

  Ok(parsed_remaining_accounts)
}
