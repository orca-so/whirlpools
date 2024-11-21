use std::{collections::HashMap, error::Error};

use futures::executor::block_on;
use orca_whirlpools_client::{
    fetch_all_position_with_filter, get_bundled_position_address, get_position_address,
    get_position_bundle_address, DecodedAccount, Position, PositionBundle, PositionFilter,
};
use orca_whirlpools_core::POSITION_BUNDLE_SIZE;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::account::Account;
use solana_sdk::pubkey::Pubkey;

use crate::{get_token_accounts_for_owner, RpcKeyedTokenAccount};

#[derive(Debug)]
pub struct HydratedPosition {
    pub address: Pubkey,
    pub data: Position,
    pub token_program: Pubkey,
}

#[derive(Debug)]
pub struct HydratedBundledPosition {
    pub address: Pubkey,
    pub data: Position,
}

#[derive(Debug)]
pub struct HydratedPositionBundle {
    pub address: Pubkey,
    pub data: PositionBundle,
    pub positions: Vec<HydratedBundledPosition>,
    pub token_program: Pubkey,
}

#[derive(Debug)]
pub enum PositionOrBundle {
    Position(HydratedPosition),
    PositionBundle(HydratedPositionBundle),
}

fn get_position_in_bundle_addresses(position_bundle: &PositionBundle) -> Vec<Pubkey> {
    let mut positions: Vec<Pubkey> = Vec::new();
    for i in 0..POSITION_BUNDLE_SIZE {
        let byte_index = i / 8;
        let bit_index = i % 8;
        if position_bundle.position_bitmap[byte_index] & (1 << bit_index) != 0 {
            let result =
                get_bundled_position_address(&position_bundle.position_bundle_mint, i as u8);
            if let Ok(result) = result {
                positions.push(result.0);
            }
        }
    }
    positions
}

pub async fn get_positions_for_owner(
    rpc: &RpcClient,
    owner: Pubkey,
) -> Result<Vec<PositionOrBundle>, Box<dyn Error>> {
    let token_accounts = get_token_accounts_for_owner(rpc, owner, spl_token::ID).await?;
    let token_extension_accounts = get_token_accounts_for_owner(rpc, owner, spl_token_2022::ID).await?;

    let potiential_tokens: Vec<RpcKeyedTokenAccount> = [token_accounts, token_extension_accounts]
        .into_iter()
        .flatten()
        .filter(|x| x.token.amount == 1)
        .collect();

    let position_addresses: Vec<Pubkey> = potiential_tokens
        .iter()
        .map(|x| get_position_address(&x.token.mint).map(|x| x.0))
        .collect::<Result<Vec<Pubkey>, _>>()?;

    let position_bundle_addresses: Vec<Pubkey> = potiential_tokens
        .iter()
        .map(|x| get_position_bundle_address(&x.token.mint).map(|x| x.0))
        .collect::<Result<Vec<Pubkey>, _>>()?;

    let position_infos = rpc.get_multiple_accounts(&position_addresses).await?;

    let positions: Vec<Option<Position>> = position_infos
        .iter()
        .map(|x| x.as_ref().and_then(|x| Position::from_bytes(&x.data).ok()))
        .collect();

    let position_bundle_infos = rpc.get_multiple_accounts(&position_bundle_addresses).await?;

    let position_bundles: Vec<Option<PositionBundle>> = position_bundle_infos
        .iter()
        .map(|x| {
            x.as_ref()
                .and_then(|x| PositionBundle::from_bytes(&x.data).ok())
        })
        .collect();

    let bundled_positions_addresses: Vec<Pubkey> = position_bundles
        .iter()
        .flatten()
        .flat_map(get_position_in_bundle_addresses)
        .collect();

    let bundled_positions_infos: Vec<Account> = rpc
        .get_multiple_accounts(&bundled_positions_addresses)
        .await?
        .into_iter()
        .flatten()
        .collect();

    let mut bundled_positions_map: HashMap<Pubkey, Vec<(Pubkey, Position)>> = HashMap::new();
    for i in 0..bundled_positions_addresses.len() {
        let bundled_position_address = bundled_positions_addresses[i];
        let bundled_position_info = &bundled_positions_infos[i];
        let position = Position::from_bytes(&bundled_position_info.data)?;
        let key = position.position_mint;
        bundled_positions_map.entry(key).or_default();
        if let Some(x) = bundled_positions_map.get_mut(&key) {
            x.push((bundled_position_address, position))
        }
    }

    let mut position_or_bundles: Vec<PositionOrBundle> = Vec::new();

    for i in 0..potiential_tokens.len() {
        let position = &positions[i];
        let position_bundle = &position_bundles[i];
        let token_account = &potiential_tokens[i];

        if let Some(position) = position {
            let position_address = position_addresses[i];
            position_or_bundles.push(PositionOrBundle::Position(HydratedPosition {
                address: position_address,
                data: position.clone(),
                token_program: token_account.token_program,
            }));
        }

        if let Some(position_bundle) = position_bundle {
            let position_bundle_address = position_bundle_addresses[i];
            let positions = bundled_positions_map
                .get(&position_bundle.position_bundle_mint)
                .unwrap_or(&Vec::new())
                .iter()
                .map(|x| HydratedBundledPosition {
                    address: x.0,
                    data: x.1.clone(),
                })
                .collect();
            position_or_bundles.push(PositionOrBundle::PositionBundle(HydratedPositionBundle {
                address: position_bundle_address,
                data: position_bundle.clone(),
                positions,
                token_program: token_account.token_program,
            }));
        }
    }

    Ok(position_or_bundles)
}

pub async fn fetch_positions_in_whirlpool(
    rpc: &RpcClient,
    whirlpool: Pubkey,
) -> Result<Vec<DecodedAccount<Position>>, Box<dyn Error>> {
    let filters = vec![PositionFilter::Whirlpool(whirlpool)];
    fetch_all_position_with_filter(rpc, filters).await
}
