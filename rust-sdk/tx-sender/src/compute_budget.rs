use crate::fee_config::{FeeConfig, Percentile, PriorityFeeStrategy};
use crate::rpc_config::RpcConfig;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_sdk::compute_budget::ComputeBudgetInstruction;

/// Calculate and return compute budget instructions for a transaction
pub async fn add_compute_budget_instructions(
    client: &RpcClient,
    compute_units: u32,
    rpc_config: &RpcConfig,
    fee_config: &FeeConfig,
    writable_accounts: &[Pubkey],
) -> Result<Vec<Instruction>, String> {
    let mut budget_instructions = Vec::new();
    
    // Add compute unit limit instruction with margin
    let compute_units_with_margin =
        (compute_units as f64 * fee_config.compute_unit_margin_multiplier) as u32;
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
                compute_units,
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
async fn calculate_dynamic_priority_fee(
    client: &RpcClient,
    rpc_config: &RpcConfig,
    writable_accounts: &[Pubkey],
    percentile: Percentile,
    _compute_units: u32, // Not used but kept for future enhancements
) -> Result<u64, String> {
    if rpc_config.supports_priority_fee_percentile {
        get_priority_fee_with_percentile(client, writable_accounts, percentile).await
    } else {
        get_priority_fee_legacy(client, writable_accounts, percentile).await
    }
}

/// Get priority fee using the getRecentPrioritizationFees endpoint with percentile parameter
async fn get_priority_fee_with_percentile(
    client: &RpcClient,
    writable_accounts: &[Pubkey],
    percentile: Percentile,
) -> Result<u64, String> {
    // This is a direct RPC call using reqwest since the Solana client doesn't support
    // the percentile parameter yet
    let rpc_url = client.url();
    let response = reqwest::Client::new()
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getRecentPrioritizationFees",
            "params": [{
                "lockedWritableAccounts": writable_accounts.iter().map(|p| p.to_string()).collect::<Vec<_>>(),
                "percentile": percentile.as_value() * 100
            }]
        }))
        .send()
        .await
        .map_err(|e| format!("Jito Error: {}", e))?;

    let data: serde_json::Value = response.json().await.map_err(|e| format!("Jito Error: {}", e))?;

    if let Some(error) = data.get("error") {
        return Err(format!("Fee Calculation Failed: RPC error: {}", error));
    }

    // Parse the result
    if let Some(result) = data.get("result") {
        if let Some(fee) = result.get("prioritizationFee").and_then(|v| v.as_u64()) {
            return Ok(fee);
        }
    }

    // Default to zero if we couldn't parse the result
    Ok(0)
}

/// Get priority fee using the legacy getRecentPrioritizationFees endpoint
async fn get_priority_fee_legacy(
    client: &RpcClient,
    writable_accounts: &[Pubkey],
    percentile: Percentile,
) -> Result<u64, String> {
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
