use std::error::Error;

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::RpcFilterType;
use solana_program::pubkey::Pubkey;

use crate::POSITION_BUNDLE_DISCRIMINATOR;
use crate::{generated::shared::DecodedAccount, PositionBundle};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum PositionBundleFilter {
    Mint(Pubkey),
}

impl From<PositionBundleFilter> for RpcFilterType {
    fn from(val: PositionBundleFilter) -> Self {
        match val {
            PositionBundleFilter::Mint(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_position_bundle_with_filter(
    rpc: &RpcClient,
    filters: Vec<PositionBundleFilter>,
) -> Result<Vec<DecodedAccount<PositionBundle>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        POSITION_BUNDLE_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
