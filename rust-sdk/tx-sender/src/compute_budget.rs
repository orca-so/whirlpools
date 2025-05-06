use crate::fee_config::{FeeConfig, Percentile, PriorityFeeStrategy};
use crate::rpc_config::RpcConfig;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcSimulateTransactionConfig;
use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_rpc_client_api::response::RpcPrioritizationFee;
use solana_sdk::address_lookup_table::AddressLookupTableAccount;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::message::{v0::Message, VersionedMessage};
use solana_sdk::transaction::VersionedTransaction;

/// Estimate compute units by simulating a transaction
pub async fn estimate_compute_units(
    rpc_client: &RpcClient,
    instructions: Vec<Instruction>,
    payer: &Pubkey,
    alts: Option<Vec<AddressLookupTableAccount>>,
) -> Result<u32, String> {
    let alt_accounts = alts.unwrap_or_default();
    let blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|e| format!("Failed to get recent blockhash: {}", e))?;

    let message = Message::try_compile(payer, &instructions, &alt_accounts, blockhash)
        .map_err(|e| format!("Failed to compile message: {}", e))?;

    let transaction = VersionedTransaction {
        signatures: vec![
            solana_sdk::signature::Signature::default();
            message.header.num_required_signatures.into()
        ],
        message: VersionedMessage::V0(message),
    };

    let result = rpc_client
        .simulate_transaction_with_config(
            &transaction,
            RpcSimulateTransactionConfig {
                sig_verify: false,
                replace_recent_blockhash: true,
                ..Default::default()
            },
        )
        .await;

    match result {
        Ok(simulation_result) => {
            if let Some(err) = simulation_result.value.err {
                return Err(format!("Transaction simulation failed: {}", err));
            }

            match simulation_result.value.units_consumed {
                Some(units) => Ok(units as u32),
                None => Err("Transaction simulation didn't return consumed units".to_string()),
            }
        }
        Err(e) => Err(format!("Transaction simulation failed: {}", e)),
    }
}

/// Calculate and return compute budget instructions for a transaction
pub async fn get_compute_budget_instruction(
    client: &RpcClient,
    compute_units: u32,
    _payer: &Pubkey,
    rpc_config: &RpcConfig,
    fee_config: &FeeConfig,
    writable_accounts: &[Pubkey],
) -> Result<Vec<Instruction>, String> {
    let mut budget_instructions = Vec::new();
    let compute_units_with_margin =
        (compute_units as f64 * (fee_config.compute_unit_margin_multiplier)) as u32;

    budget_instructions.push(ComputeBudgetInstruction::set_compute_unit_limit(
        compute_units_with_margin,
    ));

    match &fee_config.priority_fee {
        PriorityFeeStrategy::Dynamic {
            percentile,
            max_lamports,
        } => {
            let fee =
                calculate_dynamic_priority_fee(client, rpc_config, writable_accounts, *percentile)
                    .await?;
            let clamped_fee = std::cmp::min(fee, *max_lamports);

            if clamped_fee > 0 {
                budget_instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
                    clamped_fee,
                ));
            }
        }
        PriorityFeeStrategy::Exact(lamports) => {
            if *lamports > 0 {
                budget_instructions
                    .push(ComputeBudgetInstruction::set_compute_unit_price(*lamports));
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

    #[derive(serde::Deserialize)]
    struct Response {
        result: RpcPrioritizationFee,
    }

    response
        .json::<Response>()
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
