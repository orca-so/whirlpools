use serde::{Deserialize, Serialize};
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_sdk::commitment_config::CommitmentLevel;
use std::time::Duration;

/// Transaction configuration for sending transactions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionConfig {
    /// Skip preflight transaction checks
    #[serde(default)]
    pub skip_preflight: bool,

    /// Preflight commitment level
    #[serde(default)]
    pub preflight_commitment: Option<CommitmentLevel>,

    /// Maximum number of retries
    #[serde(default = "default_max_retries")]
    pub max_retries: usize,

    /// Transaction timeout in milliseconds
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64, // Store timeout as milliseconds
}

impl Default for TransactionConfig {
    fn default() -> Self {
        Self {
            skip_preflight: false,
            preflight_commitment: None,
            max_retries: default_max_retries(),
            timeout_ms: 30_000,
        }
    }
}

impl TransactionConfig {
    /// Convert to RPC send transaction config
    pub fn to_rpc_config(&self) -> RpcSendTransactionConfig {
        RpcSendTransactionConfig {
            skip_preflight: self.skip_preflight,
            preflight_commitment: self.preflight_commitment,
            encoding: None,
            max_retries: Some(self.max_retries),
            min_context_slot: None,
        }
    }

    /// Get the timeout as a `Duration`
    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.timeout_ms)
    }
}

fn default_max_retries() -> usize {
    3
}

fn default_timeout() -> u64 {
    30_000
}
