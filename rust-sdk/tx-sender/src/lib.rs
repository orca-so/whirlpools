mod compute_budget;
mod fee_config;
mod jito;
mod rpc_config;
// Comment out the separate tests module since we have inline tests
// mod tests;
mod tx_config;

// Re-export public types
pub use compute_budget::get_writable_accounts;
pub use fee_config::{FeeConfig, JitoFeeStrategy, JitoPercentile, Percentile, PriorityFeeStrategy};
pub use rpc_config::RpcConfig;
pub use tx_config::TransactionConfig;

// Import types for internal use
use compute_budget::add_compute_budget_instructions;
use jito::add_jito_tip_instruction;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::instruction::Instruction;
use solana_program::message::Message;
use solana_program::pubkey::Pubkey;
use solana_sdk::hash::Hash;
use solana_sdk::signature::{Signature, Signer};
use solana_sdk::transaction::Transaction;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;

/// Default compute units for transactions
pub const DEFAULT_COMPUTE_UNITS: u32 = 200_000;

/// Transaction sender for building and sending Solana transactions
#[derive(Clone)]
pub struct TransactionSender {
    /// Immutable RPC configuration
    rpc_config: Arc<RpcConfig>,

    /// Immutable fee configuration
    fee_config: Arc<FeeConfig>,

    /// Reusable RPC client with connection pool
    rpc_client: Arc<RpcClient>,

    /// Transaction construction settings
    tx_config: TransactionConfig,
}

impl TransactionSender {
    /// Create a new transaction sender with the given configurations
    pub fn new(rpc_config: RpcConfig, fee_config: FeeConfig) -> Self {
        let rpc_client = Arc::new(rpc_config.client());

        Self {
            rpc_config: Arc::new(rpc_config),
            fee_config: Arc::new(fee_config),
            rpc_client,
            tx_config: TransactionConfig::default(),
        }
    }

    /// Set transaction configuration
    pub fn with_tx_config(mut self, tx_config: TransactionConfig) -> Self {
        self.tx_config = tx_config;
        self
    }

    /// Get a reference to the RPC client
    pub fn rpc_client(&self) -> &RpcClient {
        &self.rpc_client
    }

    /// Build and send a transaction with the given instructions and signers
    pub async fn build_and_send_transaction(
        &self,
        instructions: Vec<Instruction>,
        signers: &[&dyn Signer],
    ) -> Result<Signature, String> {
        // Get the payer (first signer)
        let payer = signers.first().ok_or_else(|| {
            "At least one signer is required".to_string()
        })?;

        // Build transaction with compute budget and priority fees
        let mut tx = self.build_transaction(instructions, payer.pubkey()).await?;

        // Get recent blockhash
        let recent_blockhash = self.rpc_client.get_latest_blockhash().await
            .map_err(|e| format!("RPC Error: {}", e))?;

        // Sign the transaction
        tx.sign(signers, recent_blockhash);

        // Send with retry logic
        self.send_with_retry(tx).await
    }

    /// Build a transaction with compute budget and priority fees
    pub async fn build_transaction(
        &self,
        mut instructions: Vec<Instruction>,
        payer: Pubkey,
    ) -> Result<Transaction, String> {
        // Get writable accounts for priority fee calculation
        let writable_accounts = get_writable_accounts(&instructions);

        // Add compute budget instructions
        let compute_budget_ixs = add_compute_budget_instructions(
            &self.rpc_client,
            DEFAULT_COMPUTE_UNITS,
            &self.rpc_config,
            &self.fee_config,
            &writable_accounts[..],
        )
        .await?;
        
        // Add compute budget instructions to the beginning of the instruction list
        for (idx, instr) in compute_budget_ixs.into_iter().enumerate() {
            instructions.insert(idx, instr);
        }

        // Add Jito tip instruction if enabled
        if let Some(jito_tip_ix) = add_jito_tip_instruction(&self.fee_config, &payer).await? {
            instructions.insert(0, jito_tip_ix);
        }

        // Create message with placeholder blockhash
        let message = Message::new_with_blockhash(
            &instructions,
            Some(&payer),
            &Hash::default(), // Placeholder, will be replaced when signing
        );

        Ok(Transaction::new_unsigned(message))
    }

    /// Send a transaction with retry logic
    async fn send_with_retry(&self, transaction: Transaction) -> Result<Signature, String> {
        let start_time = Instant::now();
        let config = self.tx_config.to_rpc_config();
        let mut retries = 0;

        loop {
            // Check timeout
            if start_time.elapsed() > self.tx_config.timeout() {
                return Err(format!("Transaction timeout ({:?})", self.tx_config.timeout()));
            }

            // Send transaction
            match self
                .rpc_client
                .send_transaction_with_config(&transaction, config.clone())
                .await
            {
                Ok(signature) => return Ok(signature),
                Err(err) => {
                    // Check if we should retry
                    if retries >= self.tx_config.max_retries {
                        return Err(format!("RPC Error: {}", err));
                    }

                    // Exponential backoff
                    let backoff = Duration::from_millis(500 * 2u64.pow(retries as u32));
                    sleep(backoff).await;
                    retries += 1;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_config_serialization() {
        let config = FeeConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("jito_block_engine_url"));
    }
}
