use solana_client::client_error::ClientError;
use solana_sdk::signature::SignerError;
use std::time::Duration;

/// Errors that can occur during transaction building and sending
#[derive(Debug, thiserror::Error)]
pub enum TransactionError {
    #[error("RPC Error: {0}")]
    RpcError(#[from] ClientError),

    #[error("Signing Error: {0}")]
    SigningError(#[from] SignerError),

    #[error("Fee Calculation Failed: {0}")]
    FeeError(String),

    #[error("Transaction Timeout ({0:?})")]
    Timeout(Duration),

    #[error("Jito Error: {0}")]
    JitoError(#[from] reqwest::Error),

    #[error("Invalid Configuration: {0}")]
    ConfigError(String),

    #[error("Serialization Error: {0}")]
    SerializationError(#[from] bincode::Error),

    #[error("Chain Detection Error: {0}")]
    ChainDetectionError(String),
}

/// Result type for transaction operations
pub type Result<T> = std::result::Result<T, TransactionError>;
