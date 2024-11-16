use solana_client::rpc_client::RpcClient;
use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::RpcFilterType;
use solana_program::pubkey::Pubkey;
use std::error::Error;

use crate::FeeTier;

use super::utils::fetch_decoded_program_accounts;
use super::utils::DecodedAccount;

pub const FEE_TIER_DISCRIMINATOR: &[u8] = &[56, 75, 159, 76, 142, 68, 190, 105];

#[derive(Debug, Clone)]
pub enum FeeTierFilter {
    WhirlpoolsConfig(Pubkey),
    TickSpacing(u16),
    FeeRate(u16),
}

impl From<FeeTierFilter> for RpcFilterType {
    fn from(val: FeeTierFilter) -> Self {
        match val {
            FeeTierFilter::WhirlpoolsConfig(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            FeeTierFilter::TickSpacing(tick_spacing) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(40, tick_spacing.to_le_bytes().to_vec()),
            ),
            FeeTierFilter::FeeRate(fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(42, fee_rate.to_le_bytes().to_vec()))
            }
        }
    }
}

pub fn fetch_all_fee_tier_with_filter(
    rpc: &RpcClient,
    filters: Vec<FeeTierFilter>,
) -> Result<Vec<DecodedAccount<FeeTier>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        FEE_TIER_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
