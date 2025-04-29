use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::RpcFilterType;
use solana_program::pubkey::Pubkey;
use std::error::Error;

use crate::generated::shared::DecodedAccount;
use crate::AdaptiveFeeTier;

use super::utils::fetch_decoded_program_accounts;

pub const ADAPTIVE_FEE_TIER_DISCRIMINATOR: &[u8] = &[147, 16, 144, 116, 47, 146, 149, 46];

#[derive(Debug, Clone)]
pub enum AdaptiveFeeTierFilter {
    WhirlpoolsConfig(Pubkey),
    FeeTierIndex(u16),
    TickSpacing(u16),
    InitializePoolAuthority(Pubkey),
    DelegatedFeeAuthority(Pubkey),
    DefaultBaseFeeRate(u16),
    FilterPeriod(u16),
    DecayPeriod(u16),
    ReductionFactor(u16),
    AdaptiveFeeControlFactor(u32),
    MaxVolatilityAccumulator(u32),
    TickGroupSize(u16),
    MajorSwapThresholdTicks(u16),
}

impl From<AdaptiveFeeTierFilter> for RpcFilterType {
    fn from(val: AdaptiveFeeTierFilter) -> Self {
        match val {
            AdaptiveFeeTierFilter::WhirlpoolsConfig(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::FeeTierIndex(fee_tier_index) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(40, fee_tier_index.to_le_bytes().to_vec()),
            ),
            AdaptiveFeeTierFilter::TickSpacing(tick_spacing) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(42, tick_spacing.to_le_bytes().to_vec()),
            ),
            AdaptiveFeeTierFilter::InitializePoolAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(44, address.to_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::DelegatedFeeAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(76, address.to_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::DefaultBaseFeeRate(fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(108, fee_rate.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::FilterPeriod(filter_period) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(110, filter_period.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::DecayPeriod(decay_period) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(112, decay_period.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::ReductionFactor(reduction_factor) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(114, reduction_factor.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::AdaptiveFeeControlFactor(adaptive_fee_control_factor) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(116, adaptive_fee_control_factor.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::MaxVolatilityAccumulator(max_volatility_accumulator) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(120, max_volatility_accumulator.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::TickGroupSize(tick_group_size) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(124, tick_group_size.to_le_bytes().to_vec()))
            }
            AdaptiveFeeTierFilter::MajorSwapThresholdTicks(major_swap_threshold_ticks) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(126, major_swap_threshold_ticks.to_le_bytes().to_vec()))
            }
        }
    }
}

pub async fn fetch_all_adaptive_fee_tier_with_filter(
    rpc: &RpcClient,
    filters: Vec<AdaptiveFeeTierFilter>,
) -> Result<Vec<DecodedAccount<AdaptiveFeeTier>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        ADAPTIVE_FEE_TIER_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
