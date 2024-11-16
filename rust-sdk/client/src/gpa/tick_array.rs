use std::error::Error;

use solana_client::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_program::pubkey::Pubkey;

use super::utils::{fetch_decoded_program_accounts, DecodedAccount};
use crate::TickArray;

pub const TICK_ARRAY_DISCRIMINATOR: &[u8] = &[69, 97, 189, 190, 110, 7, 66, 187];

#[derive(Debug, Clone)]
pub enum TickArrayFilter {
    Whirlpool(Pubkey),
    StartTickIndex(i32),
}

impl From<TickArrayFilter> for RpcFilterType {
    fn from(val: TickArrayFilter) -> Self {
        match val {
            TickArrayFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(9956, address.to_bytes().to_vec()))
            }
            TickArrayFilter::StartTickIndex(tick_index) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, tick_index.to_le_bytes().to_vec()))
            }
        }
    }
}

pub fn fetch_all_tick_array_with_filter(
    rpc: &RpcClient,
    filters: Vec<TickArrayFilter>,
) -> Result<Vec<DecodedAccount<TickArray>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        TICK_ARRAY_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
