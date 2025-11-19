use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

pub const MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN: usize = 3;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AccountsType {
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookInput,
    TransferHookIntermediate,
    TransferHookOutput,
    SupplementalTickArrays,
    SupplementalTickArraysOne,
    SupplementalTickArraysTwo,
    // These are only used when we must be able to differentiate directional transfers (e.g. reposition liquidity)
    TransferHookADeposit,
    TransferHookBDeposit,
    TransferHookAWithdrawal,
    TransferHookBWithdrawal,
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
    pub supplemental_tick_arrays: Option<Vec<AccountInfo<'info>>>,
    pub supplemental_tick_arrays_one: Option<Vec<AccountInfo<'info>>>,
    pub supplemental_tick_arrays_two: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_a_deposit: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_b_deposit: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_a_withdrawal: Option<Vec<AccountInfo<'info>>>,
    pub transfer_hook_b_withdrawal: Option<Vec<AccountInfo<'info>>>,
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
                if parsed_remaining_accounts
                    .transfer_hook_intermediate
                    .is_some()
                {
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
            AccountsType::SupplementalTickArrays => {
                if accounts.len() > MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN {
                    return Err(ErrorCode::TooManySupplementalTickArrays.into());
                }

                if parsed_remaining_accounts.supplemental_tick_arrays.is_some() {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.supplemental_tick_arrays = Some(accounts);
            }
            AccountsType::SupplementalTickArraysOne => {
                if accounts.len() > MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN {
                    return Err(ErrorCode::TooManySupplementalTickArrays.into());
                }

                if parsed_remaining_accounts
                    .supplemental_tick_arrays_one
                    .is_some()
                {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.supplemental_tick_arrays_one = Some(accounts);
            }
            AccountsType::SupplementalTickArraysTwo => {
                if accounts.len() > MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN {
                    return Err(ErrorCode::TooManySupplementalTickArrays.into());
                }

                if parsed_remaining_accounts
                    .supplemental_tick_arrays_two
                    .is_some()
                {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.supplemental_tick_arrays_two = Some(accounts);
            }
            AccountsType::TransferHookADeposit => {
                if parsed_remaining_accounts.transfer_hook_a_deposit.is_some() {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_a_deposit = Some(accounts);
            }
            AccountsType::TransferHookBDeposit => {
                if parsed_remaining_accounts.transfer_hook_b_deposit.is_some() {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_b_deposit = Some(accounts);
            }
            AccountsType::TransferHookAWithdrawal => {
                if parsed_remaining_accounts
                    .transfer_hook_a_withdrawal
                    .is_some()
                {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_a_withdrawal = Some(accounts);
            }
            AccountsType::TransferHookBWithdrawal => {
                if parsed_remaining_accounts
                    .transfer_hook_b_withdrawal
                    .is_some()
                {
                    return Err(ErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_b_withdrawal = Some(accounts);
            }
        }
    }

    Ok(parsed_remaining_accounts)
}
