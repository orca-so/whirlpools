// Solana program imports
pub use solana_program::instruction::Instruction;
pub use solana_program::message::Message;
// Solana SDK imports
pub use solana_sdk::commitment_config::CommitmentConfig;
pub use solana_sdk::signature::{Signature, Signer};
pub use solana_sdk::transaction::Transaction;
// Solana client imports
pub use solana_client::rpc_config::RpcSendTransactionConfig;
// Standard library imports
pub use std::time::{Duration, Instant};
pub use tokio::time::sleep;

use std::sync::{Arc, OnceLock, RwLock};
use solana_sdk::commitment_config::CommitmentLevel;
use solana_client::nonblocking::rpc_client::RpcClient;

use crate::fee_config::{FeeConfig, PriorityFeeStrategy, JitoFeeStrategy};
use crate::rpc_config::RpcConfig;

/// Default transaction timeout in milliseconds
pub const DEFAULT_TRANSACTION_TIMEOUT_MS: u64 = 30_000;

/// Default number of retries
pub const DEFAULT_RETRIES: usize = 3;

/// Global configuration state
/// The `GlobalConfig` contains:
/// - `Option<RpcConfig>` - Must be explicitly set with `set_rpc()` before sending transactions
/// - `Option<Arc<RpcClient>>` - Created when RPC is set, for reuse across transactions
/// - `FeeConfig` - Configured with defaults but can be customized
static GLOBAL_CONFIG: OnceLock<RwLock<GlobalConfig>> = OnceLock::new();

// Initialize the global config
pub(crate) fn get_global_config() -> &'static RwLock<GlobalConfig> {
    GLOBAL_CONFIG.get_or_init(|| {
        RwLock::new(GlobalConfig {
            rpc_config: None,
            rpc_client: None,
            fee_config: FeeConfig::default(),
        })
    })
}

/// Global configuration for transaction sending
///
/// This struct holds the application-wide settings for transaction building and sending.
/// Access and modify it through the global functions like `set_rpc()`, `set_priority_fee_strategy()`, etc.
///
/// Note that `rpc_config` and `rpc_client` are `Option<T>` because they must be explicitly set before
/// sending transactions. Attempting to send a transaction without setting RPC first will result in
/// an error.
#[derive(Clone)]
pub struct GlobalConfig {
    /// RPC configuration (None until explicitly set)
    pub rpc_config: Option<RpcConfig>,
    /// Shared RPC client (created when RPC config is set)
    pub rpc_client: Option<Arc<RpcClient>>,
    pub fee_config: FeeConfig,
}

/// Set the RPC configuration globally
pub async fn set_rpc(url: &str) -> Result<(), String> {
    let rpc_config = RpcConfig::new(url).await?;
    let rpc_client = Arc::new(rpc_config.client());
    
    let mut config = get_global_config().write().map_err(|e| format!("Lock error: {}", e))?;
    config.rpc_config = Some(rpc_config);
    config.rpc_client = Some(rpc_client);
    Ok(())
}

/// Set the priority fee strategy globally
pub fn set_priority_fee_strategy(strategy: PriorityFeeStrategy) -> Result<(), String> {
    let mut config = get_global_config().write().map_err(|e| format!("Lock error: {}", e))?;
    config.fee_config.priority_fee = strategy;
    Ok(())
}

/// Set the Jito tip strategy globally
pub fn set_jito_fee_strategy(strategy: JitoFeeStrategy) -> Result<(), String> {
    let mut config = get_global_config().write().map_err(|e| format!("Lock error: {}", e))?;
    config.fee_config.jito = strategy;
    Ok(())
}

/// Set the compute unit margin multiplier globally
pub fn set_compute_unit_margin_multiplier(multiplier: f64) -> Result<(), String> {
    let mut config = get_global_config().write().map_err(|e| format!("Lock error: {}", e))?;
    config.fee_config.compute_unit_margin_multiplier = multiplier;
    Ok(())
}

/// Set the Jito block engine URL globally
pub fn set_jito_block_engine_url(url: String) -> Result<(), String> {
    let mut config = get_global_config().write().map_err(|e| format!("Lock error: {}", e))?;
    config.fee_config.jito_block_engine_url = url;
    Ok(())
}

/// Helper function to get RPC client from global config
pub fn get_rpc_client() -> Result<Arc<RpcClient>, String> {
    let config = get_global_config().read().map_err(|e| format!("Lock error: {}", e))?;
    // Return the shared RPC client if available
    config.rpc_client.clone().ok_or_else(|| "RPC not configured. Call set_rpc() first.".to_string())
}


#[derive(Debug, Clone)]
pub struct SendOptions {
    pub skip_preflight: bool,
    pub commitment: CommitmentLevel,
    pub max_retries: usize,
    pub timeout_ms: u64,
}

impl Default for SendOptions {
    fn default() -> Self {
        Self {
            skip_preflight: false,
            commitment: CommitmentLevel::Finalized,
            max_retries: DEFAULT_RETRIES,
            timeout_ms: DEFAULT_TRANSACTION_TIMEOUT_MS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_global_config() {
        // Test setting and getting global config values
        set_compute_unit_margin_multiplier(1.2).unwrap();
        
        let config = get_global_config().read().unwrap();
        assert_eq!(config.fee_config.compute_unit_margin_multiplier, 1.2);
        
        // Verify RPC is None by default
        assert!(config.rpc_config.is_none());
        assert!(config.rpc_client.is_none());
    }
    
    #[test]
    fn test_send_options_default() {
        let options = SendOptions::default();
        
        assert_eq!(options.skip_preflight, false);
        assert_eq!(options.commitment, CommitmentLevel::Finalized);
        assert_eq!(options.max_retries, DEFAULT_RETRIES);
        assert_eq!(options.timeout_ms, DEFAULT_TRANSACTION_TIMEOUT_MS);
    }
} 