use std::error::Error;

use super::fetch_decoded_program_accounts;
use crate::{generated::shared::DecodedAccount, LockConfig};
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::pubkey::Pubkey;

use crate::LOCK_CONFIG_DISCRIMINATOR;

#[derive(Clone, Debug)]
pub enum LockConfigFilter {
    Position(Pubkey),
    PositionOwner(Pubkey),
    Whirlpool(Pubkey),
}

impl From<LockConfigFilter> for RpcFilterType {
    fn from(val: LockConfigFilter) -> Self {
        match val {
            LockConfigFilter::Position(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            LockConfigFilter::PositionOwner(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
            LockConfigFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(72, address.to_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_lock_config_with_filter(
    rpc: &RpcClient,
    filters: Vec<LockConfigFilter>,
) -> Result<Vec<DecodedAccount<LockConfig>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        LOCK_CONFIG_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
