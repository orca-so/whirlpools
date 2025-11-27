use anchor_lang::solana_program::pubkey::Pubkey as SolanaPubkey;
use pinocchio::pubkey::Pubkey as PinoPubkey;

pub fn generate_pubkey() -> PinoPubkey {
    let solana_pubkey = SolanaPubkey::new_unique();
    solana_pubkey.to_bytes()
}
