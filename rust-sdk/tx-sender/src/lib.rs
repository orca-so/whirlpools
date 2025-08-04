mod compute_budget;
mod compute_config;
mod config;
mod fee_config;
mod jito;
mod rpc_config;
mod signer;

pub use compute_budget::*;
pub use compute_config::*;
pub use config::*;
pub use fee_config::*;
pub use jito::*;
pub use rpc_config::*;
pub use signer::*;

use solana_client::nonblocking::rpc_client::RpcClient;

/// Build and send a transaction using the supplied configuration
///
/// This function:
/// 1. Builds an unsigned transaction with all necessary instructions
/// 2. Signs the transaction with all provided signers
/// 3. Sends the transaction and waits for confirmation
/// 4. Optionally uses address lookup tables for account compression
pub async fn build_and_send_transaction_with_config<S: Signer>(
    instructions: Vec<Instruction>,
    signers: &[&S],
    commitment: Option<CommitmentLevel>,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
    rpc_client: &RpcClient,
    rpc_config: &RpcConfig,
    fee_config: &FeeConfig,
) -> Result<Signature, String> {
    // Get the payer (first signer)
    let payer = signers
        .first()
        .ok_or_else(|| "At least one signer is required".to_string())?;

    // Build transaction with compute budget and priority fees
    let mut tx = build_transaction_with_config(
        instructions,
        &payer.pubkey(),
        address_lookup_tables,
        rpc_client,
        rpc_config,
        fee_config,
    )
    .await?;
    // Serialize the message once instead of for each signer
    let serialized_message = tx.message.serialize();
    tx.signatures = signers
        .iter()
        .map(|signer| signer.sign_message(&serialized_message))
        .collect();
    // Send with retry logic
    send_transaction_with_config(tx, commitment, rpc_client).await
}

/// Build and send a transaction using the global configuration
///
/// This function:
/// 1. Builds an unsigned transaction with all necessary instructions
/// 2. Signs the transaction with all provided signers
/// 3. Sends the transaction and waits for confirmation
/// 4. Optionally uses address lookup tables for account compression
pub async fn build_and_send_transaction<S: Signer>(
    instructions: Vec<Instruction>,
    signers: &[&S],
    commitment: Option<CommitmentLevel>,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
) -> Result<Signature, String> {
    let config = config::get_global_config()
        .read()
        .map_err(|e| format!("Lock error: {}", e))?;
    let rpc_client = config::get_rpc_client()?;
    let rpc_config = config
        .rpc_config
        .as_ref()
        .ok_or("RPC config not set".to_string())?;
    let fee_config = &config.fee_config;
    build_and_send_transaction_with_config(
        instructions,
        signers,
        commitment,
        address_lookup_tables,
        &rpc_client,
        rpc_config,
        fee_config,
    )
    .await
}

#[derive(Debug, Default)]
pub struct BuildTransactionConfig {
    pub rpc_config: RpcConfig,
    pub fee_config: FeeConfig,
    pub compute_config: ComputeConfig,
}

/// Build a transaction with compute budget and priority fees from the supplied configuration
///
/// This function handles:
/// 1. Building a transaction message with all instructions
/// 2. Adding compute budget instructions
/// 3. Adding any Jito tip instructions
/// 4. Supporting address lookup tables for account compression
pub async fn build_transaction_with_config_obj(
    mut instructions: Vec<Instruction>,
    payer: &Pubkey,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
    rpc_client: &RpcClient,
    config: &BuildTransactionConfig,
) -> Result<VersionedTransaction, String> {
    let recent_blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|e| format!("RPC Error: {}", e))?;

    let writable_accounts = compute_budget::get_writable_accounts(&instructions);

    let address_lookup_tables_clone = address_lookup_tables.clone();

    let compute_units = match config.compute_config.unit_limit {
        ComputeUnitLimitStrategy::Dynamic => {
            compute_budget::estimate_compute_units(
                rpc_client,
                &instructions,
                payer,
                address_lookup_tables_clone,
            )
            .await?
        }
        ComputeUnitLimitStrategy::Exact(units) => units,
    };

    let rpc_config = &config.rpc_config;
    let fee_config = &config.fee_config;
    let budget_instructions = compute_budget::get_compute_budget_instruction(
        rpc_client,
        compute_units,
        payer,
        rpc_config,
        fee_config,
        &writable_accounts,
    )
    .await?;
    for (i, budget_ix) in budget_instructions.into_iter().enumerate() {
        instructions.insert(i, budget_ix);
    }
    // Check if network is mainnet before adding Jito tip
    if fee_config.jito != JitoFeeStrategy::Disabled {
        if !rpc_config.is_mainnet() {
            println!("Warning: Jito tips are only supported on mainnet. Skipping Jito tip.");
        } else if let Some(jito_tip_ix) = jito::add_jito_tip_instruction(fee_config, payer).await? {
            instructions.insert(0, jito_tip_ix);
        }
    }
    // Create versioned transaction message based on whether ALTs are provided
    let message = if let Some(address_lookup_tables_clone) = address_lookup_tables {
        Message::try_compile(
            payer,
            &instructions,
            &address_lookup_tables_clone,
            recent_blockhash,
        )
        .map_err(|e| format!("Failed to compile message with ALTs: {}", e))?
    } else {
        Message::try_compile(payer, &instructions, &[], recent_blockhash)
            .map_err(|e| format!("Failed to compile message: {}", e))?
    };

    // Provide the correct number of signatures for the transaction, otherwise (de)serialization can fail
    Ok(VersionedTransaction {
        signatures: vec![
            solana_sdk::signature::Signature::default();
            message.header.num_required_signatures.into()
        ],
        message: VersionedMessage::V0(message),
    })
}

/// Build a transaction with compute budget and priority fees from the supplied configuration
///
/// This function handles:
/// 1. Building a transaction message with all instructions
/// 2. Adding compute budget instructions
/// 3. Adding any Jito tip instructions
/// 4. Supporting address lookup tables for account compression
pub async fn build_transaction_with_config(
    instructions: Vec<Instruction>,
    payer: &Pubkey,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
    rpc_client: &RpcClient,
    rpc_config: &RpcConfig,
    fee_config: &FeeConfig,
) -> Result<VersionedTransaction, String> {
    build_transaction_with_config_obj(
        instructions,
        payer,
        address_lookup_tables,
        rpc_client,
        &BuildTransactionConfig {
            rpc_config: (*rpc_config).clone(),
            fee_config: (*fee_config).clone(),
            ..Default::default()
        },
    )
    .await
}

/// Build a transaction with compute budget and priority fees from the global configuration
///
/// This function handles:
/// 1. Building a transaction message with all instructions
/// 2. Adding compute budget instructions
/// 3. Adding any Jito tip instructions
/// 4. Supporting address lookup tables for account compression
pub async fn build_transaction(
    instructions: Vec<Instruction>,
    payer: &Pubkey,
    address_lookup_tables: Option<Vec<AddressLookupTableAccount>>,
) -> Result<VersionedTransaction, String> {
    let config = config::get_global_config()
        .read()
        .map_err(|e| format!("Lock error: {}", e))?;
    let rpc_client = config::get_rpc_client()?;
    let rpc_config = config
        .rpc_config
        .as_ref()
        .ok_or("RPC config not set".to_string())?;
    let fee_config = &config.fee_config;
    build_transaction_with_config(
        instructions,
        payer,
        address_lookup_tables,
        &rpc_client,
        rpc_config,
        fee_config,
    )
    .await
}

/// Send a transaction with retry logic using the supplied configuration
///
/// This function handles:
/// 1. Sending the transaction to the network
/// 2. Implementing retry logic with exponential backoff
/// 3. Waiting for transaction confirmation
pub async fn send_transaction_with_config(
    transaction: VersionedTransaction,
    commitment: Option<CommitmentLevel>,
    rpc_client: &RpcClient,
) -> Result<Signature, String> {
    let sim_result = rpc_client
        .simulate_transaction(&transaction)
        .await
        .map_err(|e| format!("Transaction simulation failed: {}", e))?;

    if let Some(err) = sim_result.value.err {
        return Err(format!("Transaction simulation failed: {}", err));
    }

    let commitment_level = commitment.unwrap_or(CommitmentLevel::Confirmed);
    let expiry_time = Instant::now() + Duration::from_millis(90_000);
    let mut retries = 0;
    let signature = transaction.signatures[0];

    while Instant::now() < expiry_time {
        // Check if the transaction has been confirmed
        let status = rpc_client
            .get_signature_status_with_commitment(
                &signature,
                CommitmentConfig {
                    commitment: commitment_level,
                },
            )
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
            // Transaction not found or still processing
            None => {
                // Try to send the transaction if not found
                println!("sending {}...", signature);
                match rpc_client
                    .send_transaction_with_config(
                        &transaction,
                        RpcSendTransactionConfig {
                            skip_preflight: true,
                            preflight_commitment: Some(commitment_level),
                            max_retries: Some(0), // We handle retries ourselves
                            ..RpcSendTransactionConfig::default()
                        },
                    )
                    .await
                {
                    Ok(_) => {
                        retries += 1;
                    }
                    Err(err) => {
                        println!("Transaction send failed (attempt {}): {}", retries, err);
                    }
                }
            }
        }
        // Always wait 1 second between loop iterations
        sleep(Duration::from_secs(1)).await;
    }

    println!("Transaction send timeout: {}", signature);
    Ok(signature)
}

/// Send a transaction with retry logic using the global configuration
///
/// This function handles:
/// 1. Sending the transaction to the network
/// 2. Implementing retry logic with exponential backoff
/// 3. Waiting for transaction confirmation
pub async fn send_transaction(
    transaction: VersionedTransaction,
    commitment: Option<CommitmentLevel>,
) -> Result<Signature, String> {
    let rpc_client = config::get_rpc_client()?;
    send_transaction_with_config(transaction, commitment, &rpc_client).await
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
