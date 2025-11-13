use solana_keypair::Keypair;
use solana_signer::Signer;
use std::convert::TryInto;
use std::fs;

pub fn load_wallet() -> Box<dyn Signer> {
    let wallet_string = fs::read_to_string("wallet.json").unwrap();
    let keypair_bytes: Vec<u8> = serde_json::from_str(&wallet_string).unwrap();
    let wallet = Keypair::new_from_array(keypair_bytes.try_into().unwrap());
    Box::new(wallet)
}
