use std::error::Error;

use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::pubkey::Pubkey;

use super::fetch_decoded_program_accounts;
use crate::{generated::shared::DecodedAccount, WhirlpoolsConfigExtension};

pub const WHIRLPOOLS_CONFIG_EXTENSION_DISCRIMINATOR: &[u8] = &[2, 99, 215, 163, 240, 26, 153, 58];

#[derive(Debug, Clone)]
pub enum WhirlpoolsConfigExtensionFilter {
    WhirlpoolsConfig(Pubkey),
    ConfigExtensionAuthority(Pubkey),
    ConfigTokenBadgeAuthority(Pubkey),
}

impl From<WhirlpoolsConfigExtensionFilter> for RpcFilterType {
    fn from(val: WhirlpoolsConfigExtensionFilter) -> Self {
        match val {
            WhirlpoolsConfigExtensionFilter::WhirlpoolsConfig(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            WhirlpoolsConfigExtensionFilter::ConfigExtensionAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
            WhirlpoolsConfigExtensionFilter::ConfigTokenBadgeAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(72, address.to_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_whirlpools_config_extension_with_filter(
    rpc: &RpcClient,
    filters: Vec<WhirlpoolsConfigExtensionFilter>,
) -> Result<Vec<DecodedAccount<WhirlpoolsConfigExtension>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        WHIRLPOOLS_CONFIG_EXTENSION_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
