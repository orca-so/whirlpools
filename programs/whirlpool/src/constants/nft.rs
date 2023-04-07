use anchor_lang::prelude::*;

pub mod whirlpool_nft_update_auth {
    use super::*;
    declare_id!("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr");
}

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
