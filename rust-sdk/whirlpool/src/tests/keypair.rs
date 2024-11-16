use std::sync::atomic::{AtomicUsize, Ordering};

use lazy_static::lazy_static;
use solana_sdk::{signature::Keypair, signer::Signer};

lazy_static! {
    static ref KEYPAIRS: Vec<Keypair> = {
        let mut keypairs = (0..100).map(|_| Keypair::new()).collect::<Vec<_>>();
        keypairs.sort_by_key(|x| x.pubkey());
        keypairs
    };
    static ref INDEX: AtomicUsize = AtomicUsize::new(0);
}

pub fn get_next_keypair() -> &'static Keypair {
    let index = INDEX.fetch_add(1, Ordering::Relaxed);
    &KEYPAIRS[index]
}
