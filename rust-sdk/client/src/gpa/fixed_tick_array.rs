use std::error::Error;

use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_pubkey::Pubkey;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;

use crate::{DecodedAccount, FixedTickArray, FIXED_TICK_ARRAY_DISCRIMINATOR};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum FixedTickArrayFilter {
    Whirlpool(Pubkey),
    StartTickIndex(i32),
}

impl From<FixedTickArrayFilter> for RpcFilterType {
    fn from(val: FixedTickArrayFilter) -> Self {
        match val {
            FixedTickArrayFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(9956, address.to_bytes().to_vec()))
            }
            FixedTickArrayFilter::StartTickIndex(tick_index) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, tick_index.to_le_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_fixed_tick_array_with_filter(
    rpc: &RpcClient,
    filters: Vec<FixedTickArrayFilter>,
) -> Result<Vec<DecodedAccount<FixedTickArray>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        FIXED_TICK_ARRAY_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
