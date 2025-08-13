use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

#[cfg(not(any(feature = "mainnet", feature = "devnet")))]
pub const ADMINS: [Pubkey; 2] = [
    // Non-confidential, just for localnet testing
    // localnet/localnet-admin-keypair-0.json
    pubkey!("tstYmkF9JHjZbSugJe1H3ygUTox1bqSxpn5QjxMwVrm"),
    // localnet/localnet-admin-keypair-1.json
    pubkey!("tstxHWKz4c1ChCqTcqvTMfcrxKQCs4ka1ypdTuZu5pH"),
];

#[cfg(feature = "devnet")]
pub const ADMINS: [Pubkey; 3] = [
    // TODO: Replace with actual admin keys
    pubkey!("11111111111111111111111111111111"),
    pubkey!("11111111111111111111111111111111"),
    pubkey!("11111111111111111111111111111111"),
];

#[cfg(feature = "mainnet")]
pub const ADMINS: [Pubkey; 3] = [
    // TODO: Replace with actual admin keys
    pubkey!("11111111111111111111111111111111"),
    pubkey!("11111111111111111111111111111111"),
    pubkey!("11111111111111111111111111111111"),
];

pub fn is_admin_key(maybe_admin: &Pubkey) -> bool {
    ADMINS.iter().any(|admin| maybe_admin.eq(admin))
}
