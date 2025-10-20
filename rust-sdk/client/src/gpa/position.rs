use std::error::Error;

use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::pubkey::Pubkey;

use crate::{generated::shared::DecodedAccount, Position, POSITION_DISCRIMINATOR};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum PositionFilter {
    Whirlpool(Pubkey),
    Mint(Pubkey),
    TickLowerIndex(i32),
    TickUpperIndex(i32),
}

impl From<PositionFilter> for RpcFilterType {
    fn from(val: PositionFilter) -> Self {
        match val {
            PositionFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            PositionFilter::Mint(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
            PositionFilter::TickLowerIndex(tick_lower_index) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(88, tick_lower_index.to_le_bytes().to_vec()),
            ),
            PositionFilter::TickUpperIndex(tick_upper_index) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(92, tick_upper_index.to_le_bytes().to_vec()),
            ),
        }
    }
}

pub async fn fetch_all_position_with_filter(
    rpc: &RpcClient,
    filters: Vec<PositionFilter>,
) -> Result<Vec<DecodedAccount<Position>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        POSITION_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
