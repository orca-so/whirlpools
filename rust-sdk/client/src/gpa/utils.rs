use std::error::Error;

use borsh::BorshDeserialize;
use solana_account_decoder::UiAccountEncoding;
use solana_client::{
    rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::RpcFilterType,
};
use solana_program::pubkey::Pubkey;
use solana_sdk::account::Account;

use crate::WHIRLPOOL_ID;

#[derive(Debug, Clone)]
pub struct DecodedAccount<T> {
    pub address: Pubkey,
    pub account: Account,
    pub data: T,
}

pub(crate) fn fetch_decoded_program_accounts<T: BorshDeserialize>(
    rpc: &RpcClient,
    filters: Vec<RpcFilterType>,
) -> Result<Vec<DecodedAccount<T>>, Box<dyn Error>> {
    let accounts = rpc.get_program_accounts_with_config(
        &WHIRLPOOL_ID,
        RpcProgramAccountsConfig {
            filters: Some(filters),
            account_config: RpcAccountInfoConfig {
                encoding: Some(UiAccountEncoding::Base64),
                data_slice: None,
                commitment: None,
                min_context_slot: None,
            },
            with_context: None,
        },
    )?;
    let mut decoded_accounts: Vec<DecodedAccount<T>> = Vec::new();
    for (address, account) in accounts {
        let mut data = account.data.as_slice();
        let decoded = T::deserialize(&mut data)?;
        decoded_accounts.push(DecodedAccount {
            address,
            account: account.clone(),
            data: decoded,
        });
    }
    Ok(decoded_accounts)
}
