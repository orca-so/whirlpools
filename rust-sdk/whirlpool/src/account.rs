use serde::Deserialize;
use serde_json::from_value;
use solana_account_decoder::UiAccountData;
use solana_client::{nonblocking::rpc_client::RpcClient, rpc_request::TokenAccountsFilter};
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sysvar_id::SysvarId;
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
}

pub(crate) async fn get_token_accounts_for_owner(
    rpc: &RpcClient,
    owner: Pubkey,
    filter: TokenAccountsFilter,
) -> Result<Vec<ParsedTokenAccount>, Box<dyn Error>> {
    let accounts = rpc.get_token_accounts_by_owner(&owner, filter).await?;

    let mut token_accounts: Vec<ParsedTokenAccount> = Vec::new();
    for account in accounts {
        if let UiAccountData::Json(data) = account.account.data {
            let token_program = match data.program.as_str() {
                "spl-token" => &spl_token_interface::ID.to_string(),
                "spl-token-2022" => &spl_token_2022_interface::ID.to_string(),
                pubkey => pubkey,
            };
            let token: Parsed = from_value(data.parsed)?;
            token_accounts.push(ParsedTokenAccount {
                pubkey: Pubkey::from_str(&account.pubkey)?,
                token_program: Pubkey::from_str(token_program)?,
                mint: Pubkey::from_str(&token.info.mint)?,
                amount: token.info.token_amount.amount.parse::<u64>()?,
            });
        }
    }
    Ok(token_accounts)
}

pub(crate) async fn get_rent(rpc: &RpcClient) -> Result<Rent, Box<dyn Error>> {
    let rent = rpc.get_account(&Rent::id()).await?;
    let rent: Rent = bincode::deserialize(&rent.data)?;
    Ok(rent)
}
