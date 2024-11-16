// import type {
//   Account,
//   Address,
//   GetProgramAccountsApi,
//   GetProgramAccountsMemcmpFilter,
//   Rpc,
// } from "@solana/web3.js";
// import {
//   getAddressEncoder,
//   getBase58Decoder,
//   getU16Encoder,
// } from "@solana/web3.js";
// import type { Whirlpool } from "../generated/accounts/whirlpool";
// import {
//   WHIRLPOOL_DISCRIMINATOR,
//   getWhirlpoolDecoder,
// } from "../generated/accounts/whirlpool";
// import { fetchDecodedProgramAccounts } from "./utils";
// import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

// export type WhirlpoolFilter = GetProgramAccountsMemcmpFilter & {
//   readonly __kind: unique symbol;
// };

// export function whirlpoolWhirlpoolConfigFilter(
//   address: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 8n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolTickSpacingFilter(
//   tickSpacing: number,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 41n,
//       bytes: getBase58Decoder().decode(getU16Encoder().encode(tickSpacing)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolFeeRateFilter(
//   defaultFeeRate: number,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 45n,
//       bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolProtocolFeeRateFilter(
//   protocolFeeRate: number,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 47n,
//       bytes: getBase58Decoder().decode(getU16Encoder().encode(protocolFeeRate)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolTokenMintAFilter(
//   tokenMintA: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 101n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintA)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolTokenVaultAFilter(
//   tokenVaultA: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 133n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultA)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolTokenMintBFilter(
//   tokenMintB: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 181n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintB)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolTokenVaultBFilter(
//   tokenVaultB: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 213n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultB)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolRewardMint1Filter(
//   rewardMint1: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 269n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint1)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolRewardVault1Filter(
//   rewardVault1: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 301n,
//       bytes: getBase58Decoder().decode(
//         getAddressEncoder().encode(rewardVault1),
//       ),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolRewardMint2Filter(
//   rewardMint2: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 397n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint2)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolRewardVault2Filter(
//   rewardVault2: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 429n,
//       bytes: getBase58Decoder().decode(
//         getAddressEncoder().encode(rewardVault2),
//       ),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolRewardMint3Filter(
//   rewardMint3: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 525n,
//       bytes: getBase58Decoder().decode(getAddressEncoder().encode(rewardMint3)),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export function whirlpoolRewardVault3Filter(
//   rewardVault3: Address,
// ): WhirlpoolFilter {
//   return {
//     memcmp: {
//       offset: 557n,
//       bytes: getBase58Decoder().decode(
//         getAddressEncoder().encode(rewardVault3),
//       ),
//       encoding: "base58",
//     },
//   } as WhirlpoolFilter;
// }

// export async function fetchAllWhirlpoolWithFilter(
//   rpc: Rpc<GetProgramAccountsApi>,
//   ...filters: WhirlpoolFilter[]
// ): Promise<Account<Whirlpool>[]> {
//   const discriminator = getBase58Decoder().decode(WHIRLPOOL_DISCRIMINATOR);
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
//     getWhirlpoolDecoder(),
//   );
// }

use std::error::Error;

use solana_client::{
    rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::pubkey::Pubkey;

use super::utils::{fetch_decoded_program_accounts, DecodedAccount};
use crate::Whirlpool;

pub const WHIRLPOOL_DISCRIMINATOR: &[u8] = &[63, 149, 209, 12, 225, 128, 99, 9];

#[derive(Debug, Clone)]
pub enum WhirlpoolFilter {
    WhirlpoolConfig(Pubkey),
    TickSpacing(u16),
    FeeRate(u16),
    ProtocolFeeRate(u16),
    TokenMintA(Pubkey),
    TokenVaultA(Pubkey),
    TokenMintB(Pubkey),
    TokenVaultB(Pubkey),
    RewardMint1(Pubkey),
    RewardVault1(Pubkey),
    RewardMint2(Pubkey),
    RewardVault2(Pubkey),
    RewardMint3(Pubkey),
    RewardVault3(Pubkey),
}

impl From<WhirlpoolFilter> for RpcFilterType {
    fn from(val: WhirlpoolFilter) -> Self {
        match val {
            WhirlpoolFilter::WhirlpoolConfig(address) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec()))
            }
            WhirlpoolFilter::TickSpacing(tick_spacing) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(41, tick_spacing.to_le_bytes().to_vec()),
            ),
            WhirlpoolFilter::FeeRate(fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(45, fee_rate.to_le_bytes().to_vec()))
            }
            WhirlpoolFilter::ProtocolFeeRate(protocol_fee_rate) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(47, protocol_fee_rate.to_le_bytes().to_vec()),
            ),
            WhirlpoolFilter::TokenMintA(token_mint_a) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(101, token_mint_a.to_bytes().to_vec()))
            }
            WhirlpoolFilter::TokenVaultA(token_vault_a) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(133, token_vault_a.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::TokenMintB(token_mint_b) => {
                RpcFilterType::Memcmp(Memcmp::new_raw_bytes(181, token_mint_b.to_bytes().to_vec()))
            }
            WhirlpoolFilter::TokenVaultB(token_vault_b) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(213, token_vault_b.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardMint1(reward_mint_1) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(269, reward_mint_1.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardVault1(reward_vault_1) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(301, reward_vault_1.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardMint2(reward_mint_2) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(397, reward_mint_2.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardVault2(reward_vault_2) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(429, reward_vault_2.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardMint3(reward_mint_3) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(525, reward_mint_3.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardVault3(reward_vault_3) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(557, reward_vault_3.to_bytes().to_vec()),
            ),
        }
    }
}

pub fn fetch_all_whirlpool_with_filter(
    rpc: &RpcClient,
    filters: Vec<WhirlpoolFilter>,
) -> Result<Vec<DecodedAccount<Whirlpool>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        WHIRLPOOL_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters)
}
