use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::RpcFilterType;
use solana_pubkey::Pubkey;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use std::error::Error;

use crate::generated::shared::DecodedAccount;
use crate::Oracle;
use crate::ORACLE_DISCRIMINATOR;

use super::utils::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum OracleFilter {
    Whirlpool(Pubkey),
    TradeEnableTimestamp(u64),
    FilterPeriod(u16),
    DecayPeriod(u16),
    ReductionFactor(u16),
    AdaptiveFeeControlFactor(u32),
    MaxVolatilityAccumulator(u32),
    TickGroupSize(u16),
    MajorSwapThresholdTicks(u16),
}

impl From<OracleFilter> for RpcFilterType {
    fn from(val: OracleFilter) -> Self {
        match val {
            OracleFilter::Whirlpool(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            OracleFilter::TradeEnableTimestamp(timestamp) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, timestamp.to_le_bytes().to_vec()))
            }
            OracleFilter::FilterPeriod(filter_period) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(48, filter_period.to_le_bytes().to_vec()),
            ),
            OracleFilter::DecayPeriod(decay_period) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(50, decay_period.to_le_bytes().to_vec()),
            ),
            OracleFilter::ReductionFactor(reduction_factor) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(52, reduction_factor.to_le_bytes().to_vec()),
            ),
            OracleFilter::AdaptiveFeeControlFactor(adaptive_fee_control_factor) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                    54,
                    adaptive_fee_control_factor.to_le_bytes().to_vec(),
                ))
            }
            OracleFilter::MaxVolatilityAccumulator(max_volatility_accumulator) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                    58,
                    max_volatility_accumulator.to_le_bytes().to_vec(),
                ))
            }
            OracleFilter::TickGroupSize(tick_group_size) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(62, tick_group_size.to_le_bytes().to_vec()),
            ),
            OracleFilter::MajorSwapThresholdTicks(major_swap_threshold_ticks) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                    64,
                    major_swap_threshold_ticks.to_le_bytes().to_vec(),
                ))
            }
        }
    }
}

pub async fn fetch_all_oracle_with_filter(
    rpc: &RpcClient,
    filters: Vec<OracleFilter>,
) -> Result<Vec<DecodedAccount<Oracle>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        ORACLE_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
