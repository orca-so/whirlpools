use std::error::Error;

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_program::pubkey::Pubkey;

use crate::{DecodedAccount, DynamicTickArray, DYNAMIC_TICK_ARRAY_DISCRIMINATOR};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum DynamicTickArrayFilter {
    Whirlpool(Pubkey),
    StartTickIndex(i32),
}

impl From<DynamicTickArrayFilter> for RpcFilterType {
    fn from(val: DynamicTickArrayFilter) -> Self {
        match val {
            DynamicTickArrayFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(12, address.to_bytes().to_vec()))
            }
            DynamicTickArrayFilter::StartTickIndex(tick_index) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, tick_index.to_le_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_dynamic_tick_array_with_filter(
    rpc: &RpcClient,
    filters: Vec<DynamicTickArrayFilter>,
) -> Result<Vec<DecodedAccount<DynamicTickArray>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        DYNAMIC_TICK_ARRAY_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
