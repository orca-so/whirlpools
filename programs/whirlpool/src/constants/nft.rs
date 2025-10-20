use anchor_lang::prelude::*;

pub mod whirlpool_nft_update_auth {
    use super::*;
    pub static ID: Pubkey = solana_program::pubkey!("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr");
}

// Based on Metaplex TokenMetadata
//
// METADATA_NAME   : max  32 bytes
// METADATA_SYMBOL : max  10 bytes
// METADATA_URI    : max 200 bytes
pub const WP_METADATA_NAME: &str = "Orca Whirlpool Position";
pub const WP_METADATA_SYMBOL: &str = "OWP";
pub const WP_METADATA_URI: &str = "https://arweave.net/E19ZNY2sqMqddm1Wx7mrXPUZ0ZZ5ISizhebb0UsVEws";

pub const WPB_METADATA_NAME_PREFIX: &str = "Orca Position Bundle";
pub const WPB_METADATA_SYMBOL: &str = "OPB";
pub const WPB_METADATA_URI: &str =
    "https://arweave.net/A_Wo8dx2_3lSUwMIi7bdT_sqxi8soghRNAWXXiqXpgE";

// Based on Token-2022 TokenMetadata extension
//
// There is no clear upper limit on the length of name, symbol, and uri,
// but it is safe for wallet apps to limit the uri to 128 bytes.
//
// see also: TokenMetadata struct
// https://github.com/solana-labs/solana-program-library/blob/cd6ce4b7709d2420bca60b4656bbd3d15d2e1485/token-metadata/interface/src/state.rs#L25
pub const WP_2022_METADATA_NAME_PREFIX: &str = "OWP";
pub const WP_2022_METADATA_SYMBOL: &str = "OWP";
pub const WP_2022_METADATA_URI_BASE: &str = "https://position-nft.orca.so/meta";
