use std::error::Error;

use solana_client::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_program::pubkey::Pubkey;

use super::utils::{fetch_decoded_program_accounts, DecodedAccount};
use crate::TokenBadge;

pub const TOKEN_BADGE_DISCRIMINATOR: &[u8] = &[116, 219, 204, 229, 249, 116, 255, 150];

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

pub fn fetch_all_token_badge_with_filter(
    rpc: &RpcClient,
    filters: Vec<TokenBadgeFilter>,
) -> Result<Vec<DecodedAccount<TokenBadge>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        TOKEN_BADGE_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
