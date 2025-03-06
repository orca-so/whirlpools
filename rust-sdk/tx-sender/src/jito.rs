use crate::error::{Result, TransactionError};
use crate::fee_config::{FeeConfig, JitoFeeStrategy, JitoPercentile};
use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_program::system_instruction;
use std::str::FromStr;
use serde_json::Value;
use rand::seq::SliceRandom;

// Jito tip receiver addresses
const JITO_TIP_ADDRESSES: [&str; 8] = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

/// Create a Jito tip instruction
pub fn create_tip_instruction(lamports: u64, payer: &Pubkey) -> Instruction {
    // Pick a random Jito tip address from the list
    let jito_address_str = JITO_TIP_ADDRESSES
        .choose(&mut rand::thread_rng())
        .expect("Failed to choose a random Jito tip address");
    
    let jito_pubkey = Pubkey::from_str(jito_address_str)
        .expect("Failed to parse Jito tip account address");
    
    system_instruction::transfer(payer, &jito_pubkey, lamports)
}

/// Calculate and create Jito tip instruction if enabled
pub async fn add_jito_tip_instruction(
    instructions: &mut Vec<Instruction>,
    fee_config: &FeeConfig,
    payer: &Pubkey,
) -> Result<()> {
    match &fee_config.jito {
        JitoFeeStrategy::Dynamic { percentile, max_lamports } => {
            let tip = calculate_dynamic_jito_tip(fee_config, *percentile).await?;
            let clamped_tip = std::cmp::min(tip, *max_lamports);
            
            if clamped_tip > 0 {
                let tip_instruction = create_tip_instruction(clamped_tip, payer);
                instructions.insert(0, tip_instruction);
            }
        },
        JitoFeeStrategy::Exact(lamports) => {
            if *lamports > 0 {
                let tip_instruction = create_tip_instruction(*lamports, payer);
                instructions.insert(0, tip_instruction);
            }
        },
        JitoFeeStrategy::Disabled => {},
    }
    
    Ok(())
}

/// Calculate dynamic Jito tip based on recent tips
async fn calculate_dynamic_jito_tip(
    fee_config: &FeeConfig,
    percentile: JitoPercentile,
) -> Result<u64> {
    // Make a request to the Jito block engine API to get recent tips
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/bundles/tip_floor", fee_config.jito_block_engine_url);
    
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| TransactionError::JitoError(e))?;
    
    if !response.status().is_success() {
        return Err(TransactionError::FeeError(format!(
            "Failed to get Jito tips: HTTP {}", 
            response.status()
        )));
    }
    
    // Parse the response as JSON
    let json_data: Value = response.json()
        .await
        .map_err(|e| TransactionError::JitoError(e))?;
    
    // Map percentile to the corresponding key in the response
    let percentile_key = match percentile {
        JitoPercentile::P25 => "landed_tips_25th_percentile",
        JitoPercentile::P50 => "landed_tips_50th_percentile",
        JitoPercentile::P50Ema => "ema_landed_tips_50th_percentile",
        JitoPercentile::P75 => "landed_tips_75th_percentile",
        JitoPercentile::P95 => "landed_tips_95th_percentile",
        JitoPercentile::P99 => "landed_tips_99th_percentile",
    };
    
    // Extract the first item from the array and get the percentile value
    if let Some(data) = json_data.as_array().and_then(|arr| arr.get(0)) {
        if let Some(value) = data.get(percentile_key).and_then(|v| v.as_f64()) {
            // Convert from SOL to lamports (multiply by 10^9)
            let lamports = (value * 1_000_000_000.0).floor() as u64;
            return Ok(lamports);
        }
    }
    
    // Default to 0 if we couldn't get a valid tip
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_tip_instruction() {
        let payer = Pubkey::new_unique();
        let instruction = create_tip_instruction(1000, &payer);
        
        assert_eq!(instruction.program_id, solana_program::system_program::id());
        assert_eq!(instruction.accounts[0].pubkey, payer);
        assert!(JITO_TIP_ADDRESSES.contains(&instruction.accounts[1].pubkey.to_string().as_str()));
    }
} 