use std::error::Error;

use solana_client::rpc_client::RpcClient;
use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::RpcFilterType;
use solana_program::pubkey::Pubkey;

use super::utils::{fetch_decoded_program_accounts, DecodedAccount};
use crate::PositionBundle;

pub const POSITION_BUNDLE_DISCRIMINATOR: &[u8] = &[129, 169, 175, 65, 185, 95, 32, 100];

#[derive(Debug, Clone)]
pub enum PositionBundleFilter {
    Whirlpool(Pubkey),
    Mint(Pubkey),
}

impl From<PositionBundleFilter> for RpcFilterType {
    fn from(val: PositionBundleFilter) -> Self {
        match val {
            PositionBundleFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            PositionBundleFilter::Mint(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
        }
    }
}

pub fn fetch_all_position_bundle_with_filter(
    rpc: &RpcClient,
    filters: Vec<PositionBundleFilter>,
) -> Result<Vec<DecodedAccount<PositionBundle>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        POSITION_BUNDLE_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
