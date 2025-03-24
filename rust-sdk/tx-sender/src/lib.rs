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
pub async fn build_and_send_transaction(
    instructions: Vec<Instruction>,
    signers: &[&dyn Signer],
    options: Option<SendOptions>,
) -> Result<Signature, String> {
    // Get the payer (first signer)
    let payer = signers.first().ok_or_else(|| {
        "At least one signer is required".to_string()
    })?;

    // Get RPC client
    let rpc_client = config::get_rpc_client()?;
      println!("getting blockhash");
    // Get recent blockhash - needed for building and signing
    let recent_blockhash = rpc_client.get_latest_blockhash().await
        .map_err(|e| format!("RPC Error: {}", e))?;

    // Log the blockhash for debugging
    println!("Using blockhash: {}", recent_blockhash);
    // Build transaction with compute budget and priority fees
    // Pass recent_blockhash to avoid fetching it twice
    let mut tx = build_transaction(instructions, *payer, recent_blockhash).await?;

    tx.sign(signers, recent_blockhash);

    // Send with retry logic
    send_transaction(tx, options).await
}

/// Build a transaction with compute budget and priority fees
/// 
/// This function handles:
/// 1. Building a transaction message with all instructions
/// 2. Adding compute budget instructions
/// 3. Adding any Jito tip instructions
pub async fn build_transaction(
    mut instructions: Vec<Instruction>,
    payer: &dyn Signer,
    recent_blockhash: impl Into<solana_sdk::hash::Hash>,
) -> Result<Transaction, String> {
    // Get the global configuration
    let config = config::get_global_config().read().map_err(|e| format!("Lock error: {}", e))?;
    
    // Get RPC client
    let rpc_client = config::get_rpc_client()?;
    
    // Convert the blockhash parameter
    let recent_blockhash = recent_blockhash.into();
    
    // Estimate compute units by simulating the transaction
    let estimated_units = compute_budget::estimate_compute_units(&rpc_client, &instructions, &payer.pubkey()).await?;
    
    // Get writable accounts for priority fee calculation
    let writable_accounts = compute_budget::get_writable_accounts(&instructions);

    let rpc_config = config.rpc_config.as_ref()
    .ok_or_else(|| "RPC not configured. Call set_rpc() first.".to_string())?;

    // Add compute budget instructions (similar to addComputeBudgetAndPriorityFeeInstructions in Kit)
    let compute_budget_ixs = compute_budget::get_compute_budget_instruction(
        &rpc_client,
        estimated_units,
        rpc_config,
        &config.fee_config,
        &writable_accounts,
    ).await?;
    
    // Add compute budget instructions to the beginning of the instruction list
    for (idx, instr) in compute_budget_ixs.into_iter().enumerate() {
        instructions.insert(idx, instr);
    }

    // Check if network is mainnet before adding Jito tip
    if config.fee_config.jito != JitoFeeStrategy::Disabled {
        if !rpc_config.is_mainnet() {
            println!("Warning: Jito tips are only supported on mainnet. Skipping Jito tip.");
        } else if let Some(jito_tip_ix) = jito::add_jito_tip_instruction(&config.fee_config, &payer.pubkey()).await? {
            instructions.insert(0, jito_tip_ix);
        }
    }

    // Create message with blockhash (similar to TransactionMessage in Kit)
    let message = Message::new_with_blockhash(
        &instructions,
        Some(&payer.pubkey()),
        &recent_blockhash,
    );
    
    // Return unsigned transaction (signing happens at the higher level)
    Ok(Transaction::new_unsigned(message))
}

/// Send a transaction with retry logic using the global configuration
/// 
/// This function handles:
/// 1. Sending the transaction to the network
/// 2. Implementing retry logic with exponential backoff
/// 3. Waiting for transaction confirmation
pub async fn send_transaction(
    transaction: Transaction,
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
