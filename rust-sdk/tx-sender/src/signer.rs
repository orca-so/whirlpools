use solana_sdk::{
    pubkey::Pubkey,
    signature::Signature,
    signer::{Signer, SignerError},
};

pub struct NoopSigner {
    pubkey: Pubkey,
}

impl NoopSigner {
    pub fn new(pubkey: Pubkey) -> Self {
        Self { pubkey }
    }
}

impl Signer for NoopSigner {
    fn try_pubkey(&self) -> Result<Pubkey, SignerError> {
        Ok(self.pubkey)
    }

    fn try_sign_message(&self, _: &[u8]) -> Result<Signature, SignerError> {
        Err(SignerError::Custom(
            "NoopSigner cannot sign transactions".to_string(),
        ))
    }

    fn is_interactive(&self) -> bool {
        false
    }
}
