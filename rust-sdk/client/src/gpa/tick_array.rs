use std::error::Error;

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_pubkey::Pubkey;

use crate::{DecodedAccount, TickArray};

use super::{fetch_all_dynamic_tick_array_with_filter, DynamicTickArrayFilter};
use super::{fetch_all_fixed_tick_array_with_filter, FixedTickArrayFilter};

#[derive(Debug, Clone)]
pub enum TickArrayFilter {
    Whirlpool(Pubkey),
    StartTickIndex(i32),
}

impl From<TickArrayFilter> for FixedTickArrayFilter {
    fn from(val: TickArrayFilter) -> Self {
        match val {
            TickArrayFilter::Whirlpool(address) => FixedTickArrayFilter::Whirlpool(address),
            TickArrayFilter::StartTickIndex(tick_index) => {
                FixedTickArrayFilter::StartTickIndex(tick_index)
            }
        }
    }
}

impl From<TickArrayFilter> for DynamicTickArrayFilter {
    fn from(val: TickArrayFilter) -> Self {
        match val {
            TickArrayFilter::Whirlpool(address) => DynamicTickArrayFilter::Whirlpool(address),
            TickArrayFilter::StartTickIndex(tick_index) => {
                DynamicTickArrayFilter::StartTickIndex(tick_index)
            }
        }
    }
}

pub async fn fetch_all_tick_array_with_filter(
    rpc: &RpcClient,
    filters: Vec<TickArrayFilter>,
) -> Result<Vec<DecodedAccount<TickArray>>, Box<dyn Error>> {
    let fixed_filters = filters
        .clone()
        .into_iter()
        .map(|filter| filter.into())
        .collect();
    let fixed_tick_arrays = fetch_all_fixed_tick_array_with_filter(rpc, fixed_filters).await?;

    let dynamic_filters = filters
        .clone()
        .into_iter()
        .map(|filter| filter.into())
        .collect();
    let dynamic_tick_arrays =
        fetch_all_dynamic_tick_array_with_filter(rpc, dynamic_filters).await?;

    let mut tick_arrays: Vec<DecodedAccount<TickArray>> = Vec::new();

    for fixed_tick_array in fixed_tick_arrays {
        tick_arrays.push(DecodedAccount {
            address: fixed_tick_array.address,
            account: fixed_tick_array.account,
            data: TickArray::FixedTickArray(fixed_tick_array.data),
        });
    }

    for dynamic_tick_array in dynamic_tick_arrays {
        tick_arrays.push(DecodedAccount {
            address: dynamic_tick_array.address,
            account: dynamic_tick_array.account,
            data: TickArray::DynamicTickArray(dynamic_tick_array.data),
        });
    }

    Ok(tick_arrays)
}
