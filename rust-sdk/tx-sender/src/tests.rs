#[cfg(test)]
mod tests {
    use crate::compute_budget;
    use crate::*;
    use solana_sdk::signature::{Keypair, Signer};
    use solana_sdk::system_instruction;

    #[test]
    fn test_get_writable_accounts() {
        let keypair = Keypair::new();
        let recipient = Keypair::new().pubkey();

        let instructions = vec![system_instruction::transfer(
            &keypair.pubkey(),
            &recipient,
            1_000_000,
        )];

        let writable_accounts = compute_budget::get_writable_accounts(&instructions);
        assert_eq!(writable_accounts.len(), 2);
        assert!(writable_accounts.contains(&keypair.pubkey()));
        assert!(writable_accounts.contains(&recipient));
    }

    #[test]
    fn test_transaction_sender_creation() {
        let rpc_config = RpcConfig::new("https://api.mainnet-beta.solana.com");
        let fee_config = FeeConfig {
            priority_fee: PriorityFeeStrategy::Dynamic {
                percentile: Percentile::P95,
                max_lamports: 1_000_000,
            },
            jito: JitoFeeStrategy::Disabled,
            compute_unit_margin_multiplier: 1.1,
            jito_block_engine_url: "https://bundles.jito.wtf".to_string(),
        };

        let sender = TransactionSender::new(rpc_config, fee_config);
        assert_eq!(sender.tx_config.max_retries, 3);
    }
}
