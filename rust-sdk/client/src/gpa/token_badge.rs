use std::error::Error;

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_pubkey::Pubkey;

use super::fetch_decoded_program_accounts;
use crate::TOKEN_BADGE_DISCRIMINATOR;
use crate::{generated::shared::DecodedAccount, TokenBadge};

#[derive(Debug, Clone)]
pub enum TokenBadgeFilter {
    WhirlpoolsConfig(Pubkey),
    TokenMint(Pubkey),
}

impl From<TokenBadgeFilter> for RpcFilterType {
    fn from(val: TokenBadgeFilter) -> Self {
        match val {
            TokenBadgeFilter::WhirlpoolsConfig(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            TokenBadgeFilter::TokenMint(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_token_badge_with_filter(
    rpc: &RpcClient,
    filters: Vec<TokenBadgeFilter>,
) -> Result<Vec<DecodedAccount<TokenBadge>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        TOKEN_BADGE_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
