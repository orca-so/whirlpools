use crate::fee_config::{FeeConfig, JitoFeeStrategy, JitoPercentile};
use serde::Deserialize;
use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_system_interface::instruction::transfer;
use std::str::FromStr;

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

/// Represents a single entry in the Jito tip data response
#[derive(Debug, Deserialize)]
pub struct JitoTipData {
    pub time: String,
    pub landed_tips_25th_percentile: f64,
    pub landed_tips_50th_percentile: f64,
    pub landed_tips_75th_percentile: f64,
    pub landed_tips_95th_percentile: f64,
    pub landed_tips_99th_percentile: f64,
    pub ema_landed_tips_50th_percentile: f64,
}

/// Create a Jito tip instruction
pub fn create_tip_instruction(lamports: u64, payer: &Pubkey) -> Instruction {
    // Pick a random Jito tip address from the list using the native random function
    let random_index = Pubkey::new_unique().to_bytes()[0] as usize % JITO_TIP_ADDRESSES.len();
    let jito_address_str = JITO_TIP_ADDRESSES[random_index];
    let jito_pubkey = Pubkey::from_str(jito_address_str).expect("Invalid pubkey string");
    transfer(payer, &jito_pubkey, lamports)
}

/// Calculate and return Jito tip instruction if enabled
pub async fn add_jito_tip_instruction(
    fee_config: &FeeConfig,
    payer: &Pubkey,
) -> Result<Option<Instruction>, String> {
    match &fee_config.jito {
        JitoFeeStrategy::Dynamic {
            percentile,
            max_lamports,
        } => {
            let tip = calculate_dynamic_jito_tip(fee_config, *percentile).await?;
            let clamped_tip = std::cmp::min(tip, *max_lamports);

            if clamped_tip > 0 {
                let tip_instruction = create_tip_instruction(clamped_tip, payer);
                return Ok(Some(tip_instruction));
            }
        }
        JitoFeeStrategy::Exact(lamports) => {
            if *lamports > 0 {
                let tip_instruction = create_tip_instruction(*lamports, payer);
                return Ok(Some(tip_instruction));
            }
        }
        JitoFeeStrategy::Disabled => {}
    }

    Ok(None)
}

/// Calculate dynamic Jito tip based on recent tips
pub(crate) async fn calculate_dynamic_jito_tip(
    fee_config: &FeeConfig,
    percentile: JitoPercentile,
) -> Result<u64, String> {
    // Make a request to the Jito block engine API to get recent tips
    let reqwest_client = reqwest::Client::new();
    let url = format!(
        "{}/api/v1/bundles/tip_floor",
        fee_config.jito_block_engine_url
    );

    let response = reqwest_client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Jito Error: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Fee Calculation Failed: Failed to get Jito tips: HTTP {}",
            response.status()
        ));
    }

    // Parse the response as a structured type
    let tip_data: Vec<JitoTipData> = response
        .json()
        .await
        .map_err(|e| format!("Jito Error: {}", e))?;

    // Get the first entry if available
    if let Some(data) = tip_data.first() {
        // Get the appropriate percentile value based on the requested percentile
        let value = match percentile {
            JitoPercentile::P25 => data.landed_tips_25th_percentile,
            JitoPercentile::P50 => data.landed_tips_50th_percentile,
            JitoPercentile::P50Ema => data.ema_landed_tips_50th_percentile,
            JitoPercentile::P75 => data.landed_tips_75th_percentile,
            JitoPercentile::P95 => data.landed_tips_95th_percentile,
            JitoPercentile::P99 => data.landed_tips_99th_percentile,
        };

        // Convert from SOL to lamports (multiply by 10^9)
        let lamports = (value * 1_000_000_000.0).floor() as u64;
        return Ok(lamports);
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

        assert_eq!(
            instruction.program_id,
            solana_system_interface::program::id()
        );
        assert_eq!(instruction.accounts[0].pubkey, payer);
        assert!(JITO_TIP_ADDRESSES.contains(&instruction.accounts[1].pubkey.to_string().as_str()));
    }
}
