use std::{collections::HashMap, error::Error};

use orca_whirlpools_client::{
    fetch_all_position_with_filter, get_bundled_position_address, get_position_address,
    get_position_bundle_address, DecodedAccount, Position, PositionBundle, PositionFilter,
};
use orca_whirlpools_core::POSITION_BUNDLE_SIZE;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::account::Account;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;

use crate::{get_token_accounts_for_owner, ParsedTokenAccount};

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
/// ```rust
/// use orca_whirlpools::{
///     fetch_positions_for_owner, set_whirlpools_config_address, WhirlpoolsConfigInput
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let whirlpool_address =
///         Pubkey::from_str("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt").unwrap();
///
///     let positions = fetch_positions_for_owner(&rpc, whirlpool_address)
///         .await
///         .unwrap();
///
///     println!("Positions: {:?}", positions);
/// }
/// ```
pub async fn fetch_positions_for_owner(
    rpc: &RpcClient,
    owner: Pubkey,
) -> Result<Vec<PositionOrBundle>, Box<dyn Error>> {
    let token_accounts = get_token_accounts_for_owner(rpc, owner, spl_token::ID).await?;
    let token_extension_accounts =
        get_token_accounts_for_owner(rpc, owner, spl_token_2022::ID).await?;

    let potiential_tokens: Vec<ParsedTokenAccount> = [token_accounts, token_extension_accounts]
        .into_iter()
        .flatten()
        .filter(|x| x.amount == 1)
        .collect();

    let position_addresses: Vec<Pubkey> = potiential_tokens
        .iter()
        .map(|x| get_position_address(&x.mint).map(|x| x.0))
        .collect::<Result<Vec<Pubkey>, _>>()?;

    let position_bundle_addresses: Vec<Pubkey> = potiential_tokens
        .iter()
        .map(|x| get_position_bundle_address(&x.mint).map(|x| x.0))
        .collect::<Result<Vec<Pubkey>, _>>()?;

    let position_infos = rpc.get_multiple_accounts(&position_addresses).await?;

    let positions: Vec<Option<Position>> = position_infos
        .iter()
        .map(|x| x.as_ref().and_then(|x| Position::from_bytes(&x.data).ok()))
        .collect();

    let position_bundle_infos = rpc
        .get_multiple_accounts(&position_bundle_addresses)
        .await?;

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
/// use orca_whirlpools::{
///     fetch_positions_in_whirlpool, set_whirlpools_config_address, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let whirlpool_address =
///         Pubkey::from_str("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt").unwrap();
///
///     let positions = fetch_positions_in_whirlpool(&rpc, whirlpool_address)
///         .await
///         .unwrap();
///
///     println!("Positions: {:?}", positions);
/// }
/// ```
pub async fn fetch_positions_in_whirlpool(
    rpc: &RpcClient,
    whirlpool: Pubkey,
) -> Result<Vec<DecodedAccount<Position>>, Box<dyn Error>> {
    let filters = vec![PositionFilter::Whirlpool(whirlpool)];
    fetch_all_position_with_filter(rpc, filters).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{
        setup_ata_with_amount, setup_mint_with_decimals, setup_position, setup_position_bundle,
        setup_te_position, setup_whirlpool, RpcContext,
    };
    use serial_test::serial;
    use solana_program_test::tokio;
    use std::error::Error;

    const DEFAULT_TICK_RANGE: (i32, i32) = (-100, 100);

    #[tokio::test]
    #[serial]
    #[ignore = "Skipped until solana-bankrun supports gpa"]
    async fn test_fetch_positions_for_owner_no_positions() -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new().await;
        let owner = ctx.signer.pubkey();
        let positions = fetch_positions_for_owner(&ctx.rpc, owner).await?;
        assert!(
            positions.is_empty(),
            "No positions should exist for a new owner"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    #[ignore = "Skipped until solana-bankrun supports gpa"]
    async fn test_fetch_positions_for_owner_with_position() -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint_with_decimals(&ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(&ctx, 9).await?;
        setup_ata_with_amount(&ctx, mint_a, 1_000_000_000).await?;
        setup_ata_with_amount(&ctx, mint_b, 1_000_000_000).await?;

        let whirlpool = setup_whirlpool(&ctx, mint_a, mint_b, 64).await?;
        let normal_position_pubkey = setup_position(&ctx, whirlpool, None, None).await?;

        // 1) Add a te_position (uses token-2022)
        let te_position_pubkey = setup_te_position(&ctx, whirlpool, None, None).await?;

        // 2) Add a position bundle, optionally with multiple bundled positions
        let position_bundle_pubkey = setup_position_bundle(whirlpool, Some(vec![(), ()])).await?;

        let owner = ctx.signer.pubkey();
        let positions = fetch_positions_for_owner(&ctx.rpc, owner).await?;

        // Expect at least 3: normal, te_position, and a bundle
        assert!(
            positions.len() >= 3,
            "Did not find all positions for the owner (expected normal, te_position, bundle)"
        );

        // Existing checks remain...
        match &positions[0] {
            PositionOrBundle::Position(pos) => {
                assert_eq!(pos.address, normal_position_pubkey);
            }
            _ => panic!("Expected a single position, but found a bundle!"),
        }

        Ok(())
    }

    #[tokio::test]
    #[serial]
    #[ignore = "Skipped until solana-bankrun supports gpa"]
    async fn test_fetch_positions_in_whirlpool() -> Result<(), Box<dyn Error>> {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint_with_decimals(&ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(&ctx, 9).await?;
        setup_ata_with_amount(&ctx, mint_a, 1_000_000_000).await?;
        setup_ata_with_amount(&ctx, mint_b, 1_000_000_000).await?;

        let whirlpool = setup_whirlpool(&ctx, mint_a, mint_b, 64).await?;
        let _normal_position_pubkey = setup_position(&ctx, whirlpool, None, None).await?;

        // 1) te_position
        let _te_position_pubkey = setup_te_position(&ctx, whirlpool, None, None).await?;

        // 2) position bundle
        let _position_bundle_pubkey = setup_position_bundle(whirlpool, Some(vec![(), ()])).await?;

        let positions = fetch_positions_in_whirlpool(&ctx.rpc, whirlpool).await?;

        // Expect at least 3: normal + te_position + bundle
        assert!(
            positions.len() >= 3,
            "Should find multiple positions in this whirlpool, including te_position & bundle"
        );

        Ok(())
    }
}
