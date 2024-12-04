use solana_sdk::{signature::Keypair, signer::Signer};
use std::fs;

pub fn load_wallet() -> Box<dyn Signer> {
    let wallet_string = fs::read_to_string("wallet.json").unwrap();
    let keypair_bytes: Vec<u8> = serde_json::from_str(&wallet_string).unwrap();
    let wallet = Keypair::from_bytes(&keypair_bytes).unwrap();
    Box::new(wallet)
}
