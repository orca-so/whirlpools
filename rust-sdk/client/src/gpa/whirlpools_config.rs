// import type {
//   GetProgramAccountsMemcmpFilter,
//   Address,
//   Account,
//   GetProgramAccountsApi,
//   Rpc,
// } from "@solana/web3.js";
// import {
//   getBase58Decoder,
//   getAddressEncoder,
//   getU16Encoder,
// } from "@solana/web3.js";
// import type { WhirlpoolsConfig } from "../generated/accounts/whirlpoolsConfig";
// import {
//   WHIRLPOOLS_CONFIG_DISCRIMINATOR,
//   getWhirlpoolsConfigDecoder,
// } from "../generated/accounts/whirlpoolsConfig";
// import { fetchDecodedProgramAccounts } from "./utils";
// import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

// export type WhirlpoolsConfigFilter = GetProgramAccountsMemcmpFilter & {
//   readonly __kind: unique symbol;
// };

// export function whirlpoolsConfigFeeAuthorityFilter(
//   feeAuthority: Address,
// ): WhirlpoolsConfigFilter {
//   return {
//     memcmp: {
//       offset: 8n,
//       bytes: getBase58Decoder().decode(
//         getAddressEncoder().encode(feeAuthority),
//       ),
//       encoding: "base58",
//     },
//   } as WhirlpoolsConfigFilter;
// }

// export function whirlpoolsConfigCollectProtocolFeesAuthorityFilter(
//   collectProtocolFeesAuthority: Address,
// ): WhirlpoolsConfigFilter {
//   return {
//     memcmp: {
//       offset: 40n,
//       bytes: getBase58Decoder().decode(
//         getAddressEncoder().encode(collectProtocolFeesAuthority),
//       ),
//       encoding: "base58",
//     },
//   } as WhirlpoolsConfigFilter;
// }

// export function whirlpoolsConfigRewardEmissionsSuperAuthorityFilter(
//   rewardEmissionsSuperAuthority: Address,
// ): WhirlpoolsConfigFilter {
//   return {
//     memcmp: {
//       offset: 72n,
//       bytes: getBase58Decoder().decode(
//         getAddressEncoder().encode(rewardEmissionsSuperAuthority),
//       ),
//       encoding: "base58",
//     },
//   } as WhirlpoolsConfigFilter;
// }

// export function whirlpoolsConfigDefaultProtocolFeeRateFilter(
//   defaultFeeRate: number,
// ): WhirlpoolsConfigFilter {
//   return {
//     memcmp: {
//       offset: 104n,
//       bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
//       encoding: "base58",
//     },
//   } as WhirlpoolsConfigFilter;
// }

// export async function fetchAllWhirlpoolsConfigWithFilter(
//   rpc: Rpc<GetProgramAccountsApi>,
//   ...filters: WhirlpoolsConfigFilter[]
// ): Promise<Account<WhirlpoolsConfig>[]> {
//   const discriminator = getBase58Decoder().decode(
//     WHIRLPOOLS_CONFIG_DISCRIMINATOR,
//   );
//   const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
//     memcmp: {
//       offset: 0n,
//       bytes: discriminator,
//       encoding: "base58",
//     },
//   };
//   return fetchDecodedProgramAccounts(
//     rpc,
//     WHIRLPOOL_PROGRAM_ADDRESS,
//     [discriminatorFilter, ...filters],
//     getWhirlpoolsConfigDecoder(),
//   );
// }

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
