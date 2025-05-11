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

const SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR: u8 = 0x02;
const SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR: u8 = 0x03;

/// Calculate and return compute budget instructions for a transaction
pub async fn get_compute_budget_instructions(
    rpc_client: &RpcClient,
    instructions: &[Instruction],
    payer: &Pubkey,
    alts: Option<Vec<AddressLookupTableAccount>>,
    rpc_config: &RpcConfig,
    fee_config: &FeeConfig,
) -> Result<Vec<Instruction>, String> {
    let existing = extract_compute_budget_ixs(instructions);
    let has_unit_limit = existing
        .iter()
        .any(|ix| matches!(ix, ComputeBudgetInstruction::SetComputeUnitLimit(_)));
    let has_unit_price = existing
        .iter()
        .any(|ix| matches!(ix, ComputeBudgetInstruction::SetComputeUnitPrice(_)));
    if has_unit_limit && has_unit_price {
        return Ok(Vec::new());
    }

    let mut compute_budget_instructions = Vec::with_capacity(2);
    if !has_unit_limit {
        let compute_units =
            estimate_compute_units(rpc_client, instructions, payer, alts.clone()).await?;
        compute_budget_instructions.push(generate_compute_unit_limit_ix(
            compute_units,
            fee_config.compute_unit_margin_multiplier,
        ));
    }

    if !has_unit_price {
        if let Some(price_ix) = generate_compute_unit_price_ix(
            rpc_client,
            rpc_config,
            &get_writable_accounts(instructions),
            &fee_config.priority_fee,
        )
        .await?
        {
            compute_budget_instructions.push(price_ix);
        }
    }

    Ok(compute_budget_instructions)
}

/// Estimate compute units by simulating a transaction
pub async fn estimate_compute_units(
    rpc_client: &RpcClient,
    instructions: &[Instruction],
    payer: &Pubkey,
    alts: Option<Vec<AddressLookupTableAccount>>,
) -> Result<u32, String> {
    let alt_accounts = alts.unwrap_or_default();
    let blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|e| format!("Failed to get recent blockhash: {}", e))?;

    let mut simulation_instructions = instructions.to_vec();
    let compute_budget_instructions = extract_compute_budget_ixs(instructions);
    let has_unit_limit = compute_budget_instructions
        .iter()
        .any(|ix| matches!(ix, ComputeBudgetInstruction::SetComputeUnitLimit(_)));
    if !has_unit_limit {
        simulation_instructions.push(ComputeBudgetInstruction::set_compute_unit_limit(1_400_000));
    }

    let message = Message::try_compile(payer, &simulation_instructions, &alt_accounts, blockhash)
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

/// Return ComputeBudgetInstruction enum variants from a list of instructions
pub fn extract_compute_budget_ixs(instructions: &[Instruction]) -> Vec<ComputeBudgetInstruction> {
    instructions
        .iter()
        .filter(|ix| ix.program_id == solana_sdk::compute_budget::ID)
        .map(to_compute_budget_instruction)
        .filter_map(|ix| ix)
        .collect()
}

/// Manually convert an instruction to a compute budget instruction, avoid
fn to_compute_budget_instruction(ix: &Instruction) -> Option<ComputeBudgetInstruction> {
    let discriminator = ix.data.first();
    if discriminator == Some(&SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR) {
        let limit_bytes_array: [u8; 4] = ix.data.get(1..5)?.try_into().ok()?;
        return Some(ComputeBudgetInstruction::SetComputeUnitLimit(
            u32::from_le_bytes(limit_bytes_array),
        ));
    } else if discriminator == Some(&SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR) {
        let price_bytes_array: [u8; 8] = ix.data.get(1..9)?.try_into().ok()?;
        return Some(ComputeBudgetInstruction::SetComputeUnitPrice(
            u64::from_le_bytes(price_bytes_array),
        ));
    } else {
        return None;
    }
}

/// Create a compute budget unit limit instruction
fn generate_compute_unit_limit_ix(compute_units: u32, margin_multiplier: f64) -> Instruction {
    let units_with_margin = (compute_units as f64 * margin_multiplier) as u32;
    ComputeBudgetInstruction::set_compute_unit_limit(units_with_margin)
}

/// Create a compute budget unit price instruction
async fn generate_compute_unit_price_ix(
    client: &RpcClient,
    rpc_config: &RpcConfig,
    writable_accounts: &[Pubkey],
    priority_fee: &PriorityFeeStrategy,
) -> Result<Option<Instruction>, String> {
    match priority_fee {
        PriorityFeeStrategy::Disabled => Ok(None),

        PriorityFeeStrategy::Exact(lamports) => {
            if *lamports > 0 {
                Ok(Some(ComputeBudgetInstruction::set_compute_unit_price(
                    *lamports,
                )))
            } else {
                Ok(None)
            }
        }

        PriorityFeeStrategy::Dynamic {
            percentile,
            max_lamports,
        } => {
            let fee =
                calculate_dynamic_priority_fee(client, rpc_config, writable_accounts, *percentile)
                    .await?;
            let clamped = std::cmp::min(fee, *max_lamports);
            if clamped > 0 {
                Ok(Some(ComputeBudgetInstruction::set_compute_unit_price(
                    clamped,
                )))
            } else {
                Ok(None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::Signer;
    use solana_sdk::signer::keypair::Keypair;
    use solana_sdk::system_instruction;
    use solana_sdk::system_program;

    #[test]
    fn test_get_writable_accounts() {
        let keypair = Keypair::new();
        let recipient = Keypair::new().pubkey();

        let instructions = vec![system_instruction::transfer(
            &keypair.pubkey(),
            &recipient,
            1_000_000,
        )];

        let writable_accounts = get_writable_accounts(&instructions);
        assert_eq!(writable_accounts.len(), 2);
        assert!(writable_accounts.contains(&keypair.pubkey()));
        assert!(writable_accounts.contains(&recipient));
    }

    #[test]
    fn test_to_compute_budget_instruction_none() {
        let non_cb_ix = Instruction {
            program_id: system_program::id(),
            accounts: vec![],
            data: vec![],
        };
        assert!(to_compute_budget_instruction(&non_cb_ix).is_none());
    }

    #[test]
    fn test_to_compute_budget_instruction_set_compute_unit_limit() {
        let limit = 1_500_000u32;
        let ix = ComputeBudgetInstruction::set_compute_unit_limit(limit);

        let result = to_compute_budget_instruction(&ix);
        assert_eq!(
            result,
            Some(ComputeBudgetInstruction::SetComputeUnitLimit(limit))
        );
    }

    #[test]
    fn test_to_compute_budget_instruction_set_compute_unit_price() {
        let price = 5_000u64;
        let ix = ComputeBudgetInstruction::set_compute_unit_price(price);

        let result = to_compute_budget_instruction(&ix);
        assert_eq!(
            result,
            Some(ComputeBudgetInstruction::SetComputeUnitPrice(price))
        );
    }
}
