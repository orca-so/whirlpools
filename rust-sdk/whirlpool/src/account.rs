use futures::executor::block_on;
use solana_account_decoder::UiAccountEncoding;
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_program::pubkey::Pubkey;
use solana_sdk::{program_pack::Pack, rent::Rent};
use spl_token_2022::state::Account;
use std::error::Error;

#[derive(Debug, Clone)]
pub struct RpcKeyedTokenAccount {
    pub pubkey: Pubkey,
    pub token_program: Pubkey,
    pub token: Account,
}

// This is a little hacky but it is done this way because
// the original get_token_accounts_for_owner uses json_parsed encoding
// and we don't want to use serde_json in this crate.
pub(crate) async fn get_token_accounts_for_owner(
    rpc: &RpcClient,
    owner: Pubkey,
    program_id: Pubkey,
) -> Result<Vec<RpcKeyedTokenAccount>, Box<dyn Error>> {
    let owner_filter = RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        32,
        owner.to_string().as_bytes().to_vec(),
    ));

    let accounts = rpc.get_program_accounts_with_config(
        &program_id,
        RpcProgramAccountsConfig {
            filters: Some(vec![owner_filter]),
            account_config: RpcAccountInfoConfig {
                encoding: Some(UiAccountEncoding::Base64),
                data_slice: None,
                commitment: None,
                min_context_slot: None,
            },
            with_context: None,
        },
    ).await?;

    let mut decoded_accounts: Vec<RpcKeyedTokenAccount> = Vec::new();
    for (address, account) in accounts {
        decoded_accounts.push(RpcKeyedTokenAccount {
            pubkey: address,
            token_program: program_id,
            token: Account::unpack(&account.data)?,
        });
    }
    Ok(decoded_accounts)
}

#[cfg(not(test))]
pub(crate) fn get_rent() -> Result<Rent, Box<dyn Error>> {
    use solana_sdk::sysvar::Sysvar;
    let rent = Rent::get()?;
    Ok(rent)
}

#[cfg(test)]
pub(crate) fn get_rent() -> Result<Rent, Box<dyn Error>> {
    Ok(Rent::default())
}
