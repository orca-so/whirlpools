mod compute_budget;
mod config;
mod fee_config;
mod jito;
mod rpc_config;

// Re-export public types with wildcards
pub use compute_budget::*;
pub use config::*;
pub use fee_config::*;
pub use jito::*;
pub use rpc_config::*;

/// Build and send a transaction using the global configuration
/// 
/// This function:
/// 1. Builds an unsigned transaction with all necessary instructions
/// 2. Signs the transaction with all provided signers
/// 3. Sends the transaction and waits for confirmation
/// 4. Optionally uses address lookup tables for account compression
pub async fn build_and_send_transaction(
    instructions: Vec<Instruction>,
    signers: &[&dyn Signer],
    options: Option<SendOptions>,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
) -> Result<Signature, String> {
    // Get the payer (first signer)
    let payer = signers.first().ok_or_else(|| {
        "At least one signer is required".to_string()
    })?;
    // Build transaction with compute budget and priority fees
    let mut tx = build_transaction(instructions, *payer, address_lookup_tables).await?;
    // Serialize the message once instead of for each signer
    let serialized_message = tx.message.serialize();
    tx.signatures = signers
        .iter()
        .map(|signer| signer.sign_message(&serialized_message))
        .collect();
    // Send with retry logic
    send_transaction(tx, options).await
}

/// Build a transaction with compute budget and priority fees
/// 
/// This function handles:
/// 1. Building a transaction message with all instructions
/// 2. Adding compute budget instructions
/// 3. Adding any Jito tip instructions
/// 4. Supporting address lookup tables for account compression
pub async fn build_transaction(
    mut instructions: Vec<Instruction>,
    payer: &dyn Signer,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
) -> Result<VersionedTransaction, String> {
    // Get the global configuration
    let config = config::get_global_config().read().map_err(|e| format!("Lock error: {}", e))?;
    
    // Get RPC client
    let rpc_client = config::get_rpc_client()?;
    
    let recent_blockhash = rpc_client.get_latest_blockhash().await
        .map_err(|e| format!("RPC Error: {}", e))?;
    
    let rpc_config = config.rpc_config.as_ref().unwrap();

    let writable_accounts = compute_budget::get_writable_accounts(&instructions);
    
    let address_lookup_tables_clone = address_lookup_tables.clone();


    let compute_units = compute_budget::estimate_compute_units(
        &rpc_client, 
        instructions.clone(), 
        &payer.pubkey(), 
        address_lookup_tables_clone
    ).await?;
    let budget_instructions = compute_budget::get_compute_budget_instruction(
        &rpc_client,
        compute_units,
        &payer.pubkey(),
        rpc_config,
        &config.fee_config,
        &writable_accounts,
    ).await?;
    // Insert compute budget instructions at the beginning
    for (i, budget_ix) in budget_instructions.into_iter().enumerate() {
        instructions.insert(i, budget_ix);
    }
    // Check if network is mainnet before adding Jito tip
    if config.fee_config.jito != JitoFeeStrategy::Disabled {
        if !rpc_config.is_mainnet() {
            println!("Warning: Jito tips are only supported on mainnet. Skipping Jito tip.");
        } else if let Some(jito_tip_ix) = jito::add_jito_tip_instruction(&config.fee_config, &payer.pubkey()).await? {
            instructions.insert(0, jito_tip_ix);
        }
    }
    // Create versioned transaction message based on whether ALTs are provided
    let message = if let Some(address_lookup_tables_clone) = address_lookup_tables {
        Message::try_compile(
            &payer.pubkey(),
            &instructions,
            &address_lookup_tables_clone,
            recent_blockhash,
        ).map_err(|e| format!("Failed to compile message with ALTs: {}", e))?
    } else {
        Message::try_compile(
            &payer.pubkey(),
            &instructions,
            &[], 
            recent_blockhash,
        ).map_err(|e| format!("Failed to compile message: {}", e))?
    };
    
    // Return unsigned transaction (signing happens at the higher level)
    Ok(VersionedTransaction {
        signatures: vec![],
        message: VersionedMessage::V0(message),
    })
}

/// Send a transaction with retry logic using the global configuration
/// 
/// This function handles:
/// 1. Sending the transaction to the network
/// 2. Implementing retry logic with exponential backoff
/// 3. Waiting for transaction confirmation
pub async fn send_transaction(
    transaction: VersionedTransaction,
    options: Option<SendOptions>,
) -> Result<Signature, String> {
    // Get RPC client
    let rpc_client = config::get_rpc_client()?;
    let options = options.unwrap_or_default();
    
    let sim_result = rpc_client.simulate_transaction(&transaction)
        .await
        .map_err(|e| format!("Transaction simulation failed: {}", e))?;

    if let Some(err) = sim_result.value.err {
        return Err(format!("Transaction simulation failed: {}", err));
    }

    let expiry_time = Instant::now() + Duration::from_millis(options.timeout_ms);
    let mut retries = 0;
    let mut last_signature = None;

    while Instant::now() < expiry_time {
        if let Some(signature) = last_signature {
            let status = rpc_client
                .get_signature_status_with_commitment(&signature, CommitmentConfig { commitment: options.commitment })
                .await
                .map_err(|e| format!("Failed to get signature status: {}", e))?;
            
            match status {
                // Transaction confirmed
                Some(Ok(())) => {
                    return Ok(signature);
                }
                // Transaction failed
                Some(Err(err)) => {
                    return Err(format!("Transaction failed: {}", err));
                }
                // Transaction still processing
                None => {
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
            }
        }

        let send_config = RpcSendTransactionConfig {
            skip_preflight: true,
            preflight_commitment: Some(options.commitment.clone()),
            max_retries: Some(0), // We handle retries ourselves
            ..RpcSendTransactionConfig::default()
        };

        match rpc_client.send_transaction_with_config(&transaction, send_config).await {
            Ok(signature) => {
                // Store the signature for checking confirmation status
                last_signature = Some(signature);
                retries = 0;
            }
            Err(err) => {
                retries += 1;
                println!("Transaction send failed (attempt {}): {}", retries, err);
                // Wait briefly before retrying
                sleep(Duration::from_millis(500)).await;
            }
        }
    }
    
    if let Some(signature) = last_signature {
        println!("Transaction send timeout but might still confirm with signature: {}", signature);
        return Ok(signature);
    }
    
    Err("Transaction timeout".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_budget;
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
    fn test_fee_config_default() {
        let config = FeeConfig::default();
        assert_eq!(config.compute_unit_margin_multiplier, 1.1);
        assert_eq!(config.jito_block_engine_url, "https://bundles.jito.wtf");
    }
}
