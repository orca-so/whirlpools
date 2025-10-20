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
pub const ADMINS: [Pubkey; 2] = [
    // fee authority of FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR (Solana Devnet)
    pubkey!("3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo"),
    // fee authority of FPydDjRdZu9sT7HVd6ANhfjh85KLq21Pefr5YWWMRPFp (Eclipse Testnet)
    pubkey!("9Pxdxw2iC1FY5qG3wsRLU6tDjstzEUvTEpPoFQeXZYMy"),
];

#[cfg(feature = "mainnet")]
pub const ADMINS: [Pubkey; 2] = [
    // program upgrade authority, multi-sig (Solana)
    pubkey!("GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV"),
    // fee authority of FVG4oDbGv16hqTUbovjyGmtYikn6UBEnazz6RVDMEFwv (Eclipse)
    pubkey!("AqiJTdr9jLPDAk5prGhWFHtSM1qJszAsdZVV7oeinxhh"),
];

pub fn is_admin_key(maybe_admin: &Pubkey) -> bool {
    ADMINS.iter().any(|admin| maybe_admin.eq(admin))
}
