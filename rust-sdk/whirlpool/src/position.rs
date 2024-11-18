use std::{collections::HashMap, error::Error};

use orca_whirlpools_client::{
    fetch_all_position_with_filter, get_bundled_position_address, get_position_address,
    get_position_bundle_address, DecodedAccount, Position, PositionBundle, PositionFilter,
};
use orca_whirlpools_core::POSITION_BUNDLE_SIZE;
use solana_client::rpc_client::RpcClient;
use solana_sdk::account::Account;
use solana_sdk::pubkey::Pubkey;

use crate::{get_token_accounts_for_owner, RpcKeyedTokenAccount};

/// Represents a single Position account.
///
/// This struct contains the address of the position NFT, its decoded data, and the token program
/// associated with the position NFT, which can be either the standard SPL Token Program or
/// the Token 2022 Program.
#[derive(Debug)]
pub struct HydratedPosition {
    /// The public key of the Position account.
    pub address: Pubkey,

    /// The decoded `Position` account data.
    pub data: Position,

    /// The public key of the token program associated with the position NFT (either SPL Token or Token 2022).
    pub token_program: Pubkey,
}

/// Represents a single bundled position within a `PositionBundle` account.
///
/// A bundled position is part of a larger `PositionBundle` and contains its own
/// address and decoded position data.
#[derive(Debug)]
pub struct HydratedBundledPosition {
    /// The public key of the bundled position.
    pub address: Pubkey,

    /// The decoded `Position` account data for the bundled position.
    pub data: Position,
}

/// Represents a Position Bundle account, which includes multiple bundled positions.
///
/// This struct contains the address and decoded data of the `PositionBundle` account,
/// along with the individual bundled positions and the associated token program.
#[derive(Debug)]
pub struct HydratedPositionBundle {
    /// The public key of the Position Bundle account.
    pub address: Pubkey,

    /// The decoded `PositionBundle` account data.
    pub data: PositionBundle,

    /// A vector of `HydratedBundledPosition` objects representing the bundled positions represented by the position NFT.
    pub positions: Vec<HydratedBundledPosition>,

    /// The public key of the token program associated with the position bundle NFT (either SPL Token or Token 2022).
    pub token_program: Pubkey,
}

/// Represents either a standalone Position account or a Position Bundle account.
///
/// This enum distinguishes between a single `HydratedPosition` and a `HydratedPositionBundle`,
/// providing a unified type for handling both cases.
#[derive(Debug)]
pub enum PositionOrBundle {
    /// A standalone `HydratedPosition`.
    Position(HydratedPosition),

    /// A `HydratedPositionBundle` containing multiple bundled positions.
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

/// Fetches all positions owned by a given wallet in the Orca Whirlpools.
///
/// This function retrieves token accounts owned by the wallet, using both the SPL Token Program
/// and Token 2022 Program. It identifies accounts holding exactly one token, which represent
/// either a position or a position bundle. For each of these accounts, it fetches the corresponding
/// position or bundle data, including any bundled positions, and returns them.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `owner` - The public key of the wallet whose positions should be fetched.
///
/// # Returns
///
/// A `Result` containing a vector of `PositionOrBundle` objects, representing the decoded
/// positions or position bundles owned by the given wallet.
///
/// # Errors
///
/// This function will return an error if:
/// - Token accounts cannot be fetched.
/// - Position or position bundle addresses cannot be derived.
/// - RPC calls fail when fetching account data.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::get_positions_for_owner;
/// use std::str::FromStr;
///
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
/// let owner = Pubkey::from_str("OWNER_PUBLIC_KEY").unwrap();
///
/// let positions = get_positions_for_owner(&rpc, owner).unwrap();
/// println!("{:?}", positions);
/// ```
pub fn get_positions_for_owner(
    rpc: &RpcClient,
    owner: Pubkey,
) -> Result<Vec<PositionOrBundle>, Box<dyn Error>> {
    let token_accounts = get_token_accounts_for_owner(rpc, owner, spl_token::ID)?;
    let token_extension_accounts = get_token_accounts_for_owner(rpc, owner, spl_token_2022::ID)?;

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

    let position_infos = rpc.get_multiple_accounts(&position_addresses)?;

    let positions: Vec<Option<Position>> = position_infos
        .iter()
        .map(|x| x.as_ref().and_then(|x| Position::from_bytes(&x.data).ok()))
        .collect();

    let position_bundle_infos = rpc.get_multiple_accounts(&position_bundle_addresses)?;

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
        .get_multiple_accounts(&bundled_positions_addresses)?
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

/// Fetches all positions associated with a specific Whirlpool.
///
/// This function retrieves all positions linked to the given Whirlpool address using
/// program filters. The positions are decoded and returned as a vector of hydrated position objects.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `whirlpool` - The public key of the Whirlpool whose positions should be fetched.
///
/// # Returns
///
/// A `Result` containing a vector of `DecodedAccount<Position>` objects, representing the
/// positions associated with the given Whirlpool.
///
/// # Errors
///
/// This function will return an error if:
/// - RPC calls fail while fetching filtered accounts.
/// - Decoding the position data fails.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::fetch_positions_in_whirlpool;
/// use std::str::FromStr;
///
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
/// let whirlpool = Pubkey::from_str("WHIRLPOOL_PUBLIC_KEY").unwrap();
///
/// let positions = fetch_positions_in_whirlpool(&rpc, whirlpool).unwrap();
/// println!("{:?}", positions);
/// ```
pub fn fetch_positions_in_whirlpool(
    rpc: &RpcClient,
    whirlpool: Pubkey,
) -> Result<Vec<DecodedAccount<Position>>, Box<dyn Error>> {
    let filters = vec![PositionFilter::Whirlpool(whirlpool)];
    fetch_all_position_with_filter(rpc, filters)
}
