// import type {
//   GetProgramAccountsMemcmpFilter,
//   Address,
//   Account,
//   GetProgramAccountsApi,
//   Rpc,
// } from "@solana/web3.js";
// import { getBase58Decoder, getAddressEncoder } from "@solana/web3.js";
// import type { TokenBadge } from "../generated/accounts/tokenBadge";
// import {
//   TOKEN_BADGE_DISCRIMINATOR,
//   getTokenBadgeDecoder,
// } from "../generated/accounts/tokenBadge";
// import { fetchDecodedProgramAccounts } from "../gpaaa/utils";
// import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

// export type TokenBadgeFilter = GetProgramAccountsMemcmpFilter & {
//   readonly __kind: unique symbol;
// };

// export function tokenBadgeWhirlpoolsConfigFilter(
//   address: Address,
// ): TokenBadgeFilter {
//   return {
//     memcmp: {
//       offset: 8n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
//       encoding: "base58",
//     },
//   } as TokenBadgeFilter;
// }

// export function tokenBadgeTokenMintFilter(address: Address): TokenBadgeFilter {
//   return {
//     memcmp: {
//       offset: 40n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
//       encoding: "base58",
//     },
//   } as TokenBadgeFilter;
// }

// export async function fetchAllTokenBadgeWithFilter(
//   rpc: Rpc<GetProgramAccountsApi>,
//   ...filters: TokenBadgeFilter[]
// ): Promise<Account<TokenBadge>[]> {
//   const discriminator = getBase58Decoder().decode(TOKEN_BADGE_DISCRIMINATOR);
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
//     getTokenBadgeDecoder(),
//   );
// }

use std::error::Error;

use solana_client::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_program::pubkey::Pubkey;

use super::utils::{fetch_decoded_program_accounts, DecodedAccount};
use crate::TokenBadge;

pub const TOKEN_BADGE_DISCRIMINATOR: &[u8] = &[116, 219, 204, 229, 249, 116, 255, 150];

#[derive(Debug, Clone)]
pub enum TokenBadgeFilter {
    WhirlpoolsConfig(Pubkey),
    TokenMint(Pubkey),
}

impl From<TokenBadgeFilter> for RpcFilterType {
    fn from(val: TokenBadgeFilter) -> Self {
        match val {
            TokenBadgeFilter::WhirlpoolsConfig(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            TokenBadgeFilter::TokenMint(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec()))
            }
        }
    }
}

pub fn fetch_all_token_badge_with_filter(
    rpc: &RpcClient,
    filters: Vec<TokenBadgeFilter>,
) -> Result<Vec<DecodedAccount<TokenBadge>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        TOKEN_BADGE_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
