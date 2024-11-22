use std::error::Error;

use solana_client::{
    nonblocking::rpc_client::RpcClient,
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
    RewardMint0(Pubkey),
    RewardVault0(Pubkey),
    RewardMint1(Pubkey),
    RewardVault1(Pubkey),
    RewardMint2(Pubkey),
    RewardVault2(Pubkey),
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
            WhirlpoolFilter::RewardMint0(reward_mint_0) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(269, reward_mint_0.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardVault0(reward_vault_0) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(301, reward_vault_0.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardMint1(reward_mint_1) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(397, reward_mint_1.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardVault1(reward_vault_1) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(429, reward_vault_1.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardMint2(reward_mint_2) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(525, reward_mint_2.to_bytes().to_vec()),
            ),
            WhirlpoolFilter::RewardVault2(reward_vault_2) => RpcFilterType::Memcmp(
                Memcmp::new_raw_bytes(557, reward_vault_2.to_bytes().to_vec()),
            ),
        }
    }
}

pub async fn fetch_all_whirlpool_with_filter(
    rpc: &RpcClient,
    filters: Vec<WhirlpoolFilter>,
) -> Result<Vec<DecodedAccount<Whirlpool>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
        0,
        WHIRLPOOL_DISCRIMINATOR.to_vec(),
    )));
    fetch_decoded_program_accounts(rpc, filters).await
}
