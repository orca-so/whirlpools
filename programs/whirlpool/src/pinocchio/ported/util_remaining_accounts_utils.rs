use crate::pinocchio::errors::WhirlpoolErrorCode;
use crate::pinocchio::Result;
use crate::util::{AccountsType, RemainingAccountsInfo, MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN};
use pinocchio::account_info::AccountInfo;

#[derive(Default)]
pub struct PinoParsedRemainingAccounts<'a> {
    pub transfer_hook_a: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_b: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_reward: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_input: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_intermediate: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_output: Option<Vec<&'a AccountInfo>>,
    pub supplemental_tick_arrays: Option<Vec<&'a AccountInfo>>,
    pub supplemental_tick_arrays_one: Option<Vec<&'a AccountInfo>>,
    pub supplemental_tick_arrays_two: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_a_deposit: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_b_deposit: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_a_withdrawal: Option<Vec<&'a AccountInfo>>,
    pub transfer_hook_b_withdrawal: Option<Vec<&'a AccountInfo>>,
}

pub fn pino_parse_remaining_accounts<'a>(
    remaining_accounts: &'a [AccountInfo],
    remaining_accounts_info: &Option<RemainingAccountsInfo>,
    valid_accounts_type_list: &[AccountsType],
) -> Result<PinoParsedRemainingAccounts<'a>> {
    let mut remaining_accounts_iter = remaining_accounts.iter();
    let mut parsed_remaining_accounts = PinoParsedRemainingAccounts::default();

    if remaining_accounts_info.is_none() {
        return Ok(parsed_remaining_accounts);
    }

    let remaining_accounts_info = remaining_accounts_info.as_ref().unwrap();

    for slice in remaining_accounts_info.slices.iter() {
        if !valid_accounts_type_list.contains(&slice.accounts_type) {
            return Err(WhirlpoolErrorCode::RemainingAccountsInvalidSlice.into());
        }
        if slice.length == 0 {
            continue;
        }

        let mut accounts: Vec<&AccountInfo> = Vec::with_capacity(slice.length as usize);
        for _ in 0..slice.length {
            if let Some(account) = remaining_accounts_iter.next() {
                accounts.push(account);
            } else {
                return Err(WhirlpoolErrorCode::RemainingAccountsInsufficient.into());
            }
        }

        match slice.accounts_type {
            AccountsType::TransferHookA => {
                if parsed_remaining_accounts.transfer_hook_a.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_a = Some(accounts);
            }
            AccountsType::TransferHookB => {
                if parsed_remaining_accounts.transfer_hook_b.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_b = Some(accounts);
            }
            AccountsType::TransferHookReward => {
                if parsed_remaining_accounts.transfer_hook_reward.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_reward = Some(accounts);
            }
            AccountsType::TransferHookInput => {
                if parsed_remaining_accounts.transfer_hook_input.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_input = Some(accounts);
            }
            AccountsType::TransferHookIntermediate => {
                if parsed_remaining_accounts
                    .transfer_hook_intermediate
                    .is_some()
                {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_intermediate = Some(accounts);
            }
            AccountsType::TransferHookOutput => {
                if parsed_remaining_accounts.transfer_hook_output.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_output = Some(accounts);
            }
            AccountsType::SupplementalTickArrays => {
                if accounts.len() > MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN {
                    return Err(WhirlpoolErrorCode::TooManySupplementalTickArrays.into());
                }

                if parsed_remaining_accounts.supplemental_tick_arrays.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.supplemental_tick_arrays = Some(accounts);
            }
            AccountsType::SupplementalTickArraysOne => {
                if accounts.len() > MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN {
                    return Err(WhirlpoolErrorCode::TooManySupplementalTickArrays.into());
                }

                if parsed_remaining_accounts
                    .supplemental_tick_arrays_one
                    .is_some()
                {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.supplemental_tick_arrays_one = Some(accounts);
            }
            AccountsType::SupplementalTickArraysTwo => {
                if accounts.len() > MAX_SUPPLEMENTAL_TICK_ARRAYS_LEN {
                    return Err(WhirlpoolErrorCode::TooManySupplementalTickArrays.into());
                }

                if parsed_remaining_accounts
                    .supplemental_tick_arrays_two
                    .is_some()
                {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.supplemental_tick_arrays_two = Some(accounts);
            }
            AccountsType::TransferHookADeposit => {
                if parsed_remaining_accounts.transfer_hook_a_deposit.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_a_deposit = Some(accounts);
            }
            AccountsType::TransferHookBDeposit => {
                if parsed_remaining_accounts.transfer_hook_b_deposit.is_some() {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_b_deposit = Some(accounts);
            }
            AccountsType::TransferHookAWithdrawal => {
                if parsed_remaining_accounts
                    .transfer_hook_a_withdrawal
                    .is_some()
                {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_a_withdrawal = Some(accounts);
            }
            AccountsType::TransferHookBWithdrawal => {
                if parsed_remaining_accounts
                    .transfer_hook_b_withdrawal
                    .is_some()
                {
                    return Err(WhirlpoolErrorCode::RemainingAccountsDuplicatedAccountsType.into());
                }
                parsed_remaining_accounts.transfer_hook_b_withdrawal = Some(accounts);
            }
        }
    }

    Ok(parsed_remaining_accounts)
}
