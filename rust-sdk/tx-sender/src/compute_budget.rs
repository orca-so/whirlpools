use crate::fee_config::{FeeConfig, Percentile, PriorityFeeStrategy};
use crate::rpc_config::RpcConfig;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_rpc_client_api::response::RpcPrioritizationFee;
use solana_client::rpc_config::RpcSimulateTransactionConfig;

/// Estimate compute units by simulating a transaction
pub async fn estimate_compute_units(
    rpc_client: &RpcClient,
    instructions: &[Instruction],
    payer: &Pubkey,
) -> Result<u32, String> {
    let recent_blockhash = rpc_client.get_latest_blockhash().await
        .map_err(|e| format!("RPC Error: {}", e))?;
    
    let message = solana_sdk::message::Message::new_with_blockhash(
        instructions, 
        Some(payer), 
        &recent_blockhash
    );
    
    let legacy_transaction = solana_sdk::transaction::Transaction::new_unsigned(message.clone());
    
    // Configure simulation options
    let config = RpcSimulateTransactionConfig {
        sig_verify: false,                 // Skip signature verification
        replace_recent_blockhash: true,    // Use a recent blockhash from the server
        commitment: None,                  // Use default commitment
        encoding: None,                    // Use default encoding
        accounts: None,                    // No additional account configs
        min_context_slot: None,            // No minimum slot
        inner_instructions: false,         // Don't include inner instructions
    };
    
    // Simulate transaction with config
    let simulation_result = rpc_client.simulate_transaction_with_config(
        &legacy_transaction,
        config,
    )
    .await
    .map_err(|e| format!("Transaction simulation failed: {}", e))?;
    
    // Return error if simulation failed
    if let Some(err) = simulation_result.value.err {
        return Err(format!("Transaction simulation failed: {}", err));
    }
    
    // Return error if no units consumed value was returned
    match simulation_result.value.units_consumed {
        Some(units) => Ok(units as u32),
        None => Err("Transaction simulation didn't return consumed units".to_string())
    }
}


/// Calculate and return compute budget instructions for a transaction
pub async fn get_compute_budget_instruction(
    client: &RpcClient,
    compute_units: u32,
    rpc_config: &RpcConfig,
    fee_config: &FeeConfig,
    writable_accounts: &[Pubkey],
) -> Result<Vec<Instruction>, String> {
    let mut budget_instructions = Vec::new();
    
    // Add compute unit limit instruction with margin
    // Calculate percentage margin from the multiplier
    let compute_units_with_margin = (compute_units as f64 * (fee_config.compute_unit_margin_multiplier)) as u32;

    
    budget_instructions.push(
        ComputeBudgetInstruction::set_compute_unit_limit(compute_units_with_margin),
    );

    // Add priority fee instruction if configured
    match &fee_config.priority_fee {
        PriorityFeeStrategy::Dynamic {
            percentile,
            max_lamports,
        } => {
            let fee = calculate_dynamic_priority_fee(
                client,
                rpc_config,
                writable_accounts,
                *percentile,
            )
            .await?;
            let clamped_fee = std::cmp::min(fee, *max_lamports);

            if clamped_fee > 0 {
                budget_instructions.push(
                    ComputeBudgetInstruction::set_compute_unit_price(clamped_fee),
                );
            }
        }
        PriorityFeeStrategy::Exact(lamports) => {
            if *lamports > 0 {
                budget_instructions.push(
                    ComputeBudgetInstruction::set_compute_unit_price(*lamports),
                );
            }
        }
        PriorityFeeStrategy::Disabled => {}
    }

    Ok(budget_instructions)
}

/// Calculate dynamic priority fee based on recent fees
pub(crate) async fn calculate_dynamic_priority_fee(
    client: &RpcClient,
    rpc_config: &RpcConfig,
    writable_accounts: &[Pubkey],
    percentile: Percentile,
) -> Result<u64, String> {
    if rpc_config.supports_priority_fee_percentile {
        get_priority_fee_with_percentile(client, writable_accounts, percentile).await
    } else {
        get_priority_fee_legacy(client, writable_accounts, percentile).await
    }
}

/// Get priority fee using the getRecentPrioritizationFees endpoint with percentile parameter
pub(crate) async fn get_priority_fee_with_percentile(
    client: &RpcClient,
    writable_accounts: &[Pubkey],
    percentile: Percentile,
) -> Result<u64, String> {
    // This is a direct RPC call using reqwest since the Solana client doesn't support
    // the percentile parameter yet
    let rpc_url = client.url();
   
    // Send RPC request with percentile parameter
    let response = reqwest::Client::new()
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getRecentPrioritizationFees",
            "params": [{
                "lockedWritableAccounts": writable_accounts.iter().map(|p| p.to_string()).collect::<Vec<String>>(),
                "percentile": percentile.as_value() * 100
            }]
        }))
        .send()
        .await
        .map_err(|e| format!("RPC Error: {}", e))?;

    // Define minimal response structure and directly extract the prioritization fee
    #[derive(serde::Deserialize)]
    struct Response {
        result: RpcPrioritizationFee,
    }
    
    response.json::<Response>()
        .await
        .map(|resp| resp.result.prioritization_fee)
        .map_err(|e| format!("Failed to parse prioritization fee response: {}", e))
}

/// Get priority fee using the legacy getRecentPrioritizationFees endpoint
pub(crate) async fn get_priority_fee_legacy(
    client: &RpcClient,
    writable_accounts: &[Pubkey],
    percentile: Percentile,
) -> Result<u64, String> {
    // This uses the built-in method that returns Vec<RpcPrioritizationFee>
    let recent_fees = client
        .get_recent_prioritization_fees(writable_accounts)
        .await
        .map_err(|e| format!("RPC Error: {}", e))?;

    // Filter out zero fees and sort
    let mut non_zero_fees: Vec<u64> = recent_fees
        .iter()
        .filter(|fee| fee.prioritization_fee > 0)
        .map(|fee| fee.prioritization_fee)
        .collect();

    non_zero_fees.sort_unstable();

    if non_zero_fees.is_empty() {
        return Ok(0);
    }

    // Calculate percentile
    let index = (non_zero_fees.len() as f64 * (percentile.as_value() as f64 / 100.0)) as usize;
    let index = std::cmp::min(index, non_zero_fees.len() - 1);

    Ok(non_zero_fees[index])
}

/// Get writable accounts from a list of instructions
pub fn get_writable_accounts(instructions: &[Instruction]) -> Vec<Pubkey> {
    let mut writable = std::collections::HashSet::new();

    for ix in instructions {
        for meta in &ix.accounts {
            if meta.is_writable {
                writable.insert(meta.pubkey);
            }
        }
    }

    writable.into_iter().collect()
}
