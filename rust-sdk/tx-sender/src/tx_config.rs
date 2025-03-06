use serde::{Deserialize, Serialize};
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_sdk::commitment_config::{CommitmentConfig, CommitmentLevel};
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

    /// Transaction timeout
    #[serde(with = "humantime_serde", default = "default_timeout")]
    pub timeout: Duration,
}

impl Default for TransactionConfig {
    fn default() -> Self {
        Self {
            skip_preflight: false,
            preflight_commitment: None,
            max_retries: default_max_retries(),
            timeout: default_timeout(),
        }
    }
}

impl TransactionConfig {
    /// Convert to RPC send transaction config
    pub fn to_rpc_config(&self) -> RpcSendTransactionConfig {
        RpcSendTransactionConfig {
            skip_preflight: self.skip_preflight,
            preflight_commitment: self
                .preflight_commitment
                .map(|level| CommitmentConfig::from(level)),
            encoding: None,
            max_retries: Some(self.max_retries),
            min_context_slot: None,
        }
    }
}

fn default_max_retries() -> usize {
    3
}

fn default_timeout() -> Duration {
    Duration::from_secs(30)
}
