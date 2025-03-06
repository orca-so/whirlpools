#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::system_instruction;
    use solana_sdk::signature::Keypair;
    
    #[test]
    fn test_fee_config_serialization() {
        let config = FeeConfig {
            priority_fee: PriorityFeeStrategy::Dynamic {
                percentile: Percentile::P95,
                max_lamports: 1_000_000,
            },
            ..Default::default()
        };
        
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: FeeConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(config, deserialized);
    }
    
    #[test]
    fn test_rpc_config_serialization() {
        let config = RpcConfig::new("https://api.mainnet-beta.solana.com");
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: RpcConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(config.url, deserialized.url);
        assert_eq!(config.supports_priority_fee_percentile, deserialized.supports_priority_fee_percentile);
        assert_eq!(config.timeout, deserialized.timeout);
    }
    
    #[test]
    fn test_transaction_building() {
        let keypair = Keypair::new();
        let recipient = Keypair::new().pubkey();
        
        let transfer_ix = system_instruction::transfer(
            &keypair.pubkey(),
            &recipient,
            1_000_000,
        );
        
        let instructions = vec![transfer_ix];
        assert_eq!(instructions.len(), 1);
        
        let writable_accounts = compute_budget::get_writable_accounts(&instructions);
        assert_eq!(writable_accounts.len(), 2); // Sender and recipient are writable
    }
    
    #[tokio::test]
    #[ignore] // Requires network connection
    async fn test_priority_fee_calculation() {
        let rpc_config = RpcConfig::new("https://api.mainnet-beta.solana.com");
        let fee_config = FeeConfig {
            priority_fee: PriorityFeeStrategy::Dynamic {
                percentile: Percentile::P95,
                max_lamports: 1_000_000,
            },
            ..Default::default()
        };
        
        let sender = TransactionSender::new(rpc_config, fee_config);
        
        // This test would need a mock RPC client to be fully testable
        // For now, we just ensure the code compiles
        assert!(sender.rpc_client.url().contains("mainnet-beta"));
    }
} 