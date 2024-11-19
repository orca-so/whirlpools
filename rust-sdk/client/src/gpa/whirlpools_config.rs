use std::error::Error;

use solana_client::{
    rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::pubkey::Pubkey;

use super::utils::{fetch_decoded_program_accounts, DecodedAccount};
use crate::WhirlpoolsConfig;

pub const WHIRLPOOLS_CONFIG_DISCRIMINATOR: &[u8] = &[157, 20, 49, 224, 217, 87, 193, 254];

#[derive(Debug, Clone)]
pub enum WhirlpoolsConfigFilter {
    FeeAuthority(Pubkey),
    CollectProtocolFeesAuthority(Pubkey),
    RewardEmissionsSuperAuthority(Pubkey),
    DefaultProtocolFeeRate(u16),
}

impl From<WhirlpoolsConfigFilter> for RpcFilterType {
    fn from(val: WhirlpoolsConfigFilter) -> Self {
        match val {
            WhirlpoolsConfigFilter::FeeAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            WhirlpoolsConfigFilter::CollectProtocolFeesAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
            WhirlpoolsConfigFilter::RewardEmissionsSuperAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(72, address.to_bytes().to_vec()))
            }
            WhirlpoolsConfigFilter::DefaultProtocolFeeRate(fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(104, fee_rate.to_le_bytes().to_vec()))
            }
        }
    }
}

pub fn fetch_all_whirlpools_config_with_filter(
    rpc: &RpcClient,
    filters: Vec<WhirlpoolsConfigFilter>,
) -> Result<Vec<DecodedAccount<WhirlpoolsConfig>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        WHIRLPOOLS_CONFIG_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
