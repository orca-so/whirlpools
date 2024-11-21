use serde::Deserialize;
use serde_json::from_value;
use solana_account_decoder::UiAccountData;
use solana_client::{rpc_client::RpcClient, rpc_request::TokenAccountsFilter};
use solana_program::pubkey::Pubkey;
use solana_sdk::rent::Rent;
use solana_sdk::sysvar::SysvarId;
use std::{error::Error, str::FromStr};

#[derive(Debug, Clone)]
pub struct ParsedTokenAccount {
    pub pubkey: Pubkey,
    pub token_program: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[derive(Deserialize, Clone, Debug)]
struct Parsed {
    info: SplToken,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SplToken {
    mint: String,
    token_amount: Amount,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Amount {
    amount: String,
    ui_amount_string: String,
    ui_amount: f64,
    decimals: u8,
}

// This is a little hacky but it is done this way because
// the original get_token_accounts_for_owner uses json_parsed encoding
// and we don't want to use serde_json in this crate.
pub(crate) fn get_token_accounts_for_owner(
    rpc: &RpcClient,
    owner: Pubkey,
    program_id: Pubkey,
) -> Result<Vec<ParsedTokenAccount>, Box<dyn Error>> {
    let accounts =
        rpc.get_token_accounts_by_owner(&owner, TokenAccountsFilter::ProgramId(program_id))?;

    let mut token_accounts: Vec<ParsedTokenAccount> = Vec::new();
    for account in accounts {
        if let UiAccountData::Json(data) = account.account.data {
            let token: Parsed = from_value(data.parsed)?;
            token_accounts.push(ParsedTokenAccount {
                pubkey: Pubkey::from_str(&account.pubkey)?,
                token_program: program_id,
                mint: Pubkey::from_str(&token.info.mint)?,
                amount: token.info.token_amount.amount.parse::<u64>()?,
            });
        }
    }
    Ok(token_accounts)
}

pub(crate) fn get_rent(rpc: &RpcClient) -> Result<Rent, Box<dyn Error>> {
    let rent = rpc.get_account(&Rent::id())?;
    let rent: Rent = bincode::deserialize(&rent.data)?;
    Ok(rent)
}
