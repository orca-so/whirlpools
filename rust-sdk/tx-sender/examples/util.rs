#![allow(dead_code)]
use solana_cli_config::Config;
use solana_instruction::AccountMeta;
use solana_keypair::{read_keypair_file, Keypair};
use solana_program::instruction::Instruction;
use solana_pubkey::Pubkey;
use std::error::Error;

/// Load a keypair from the Solana CLI config
///
/// This function reads the keypair path from the Solana CLI config file
/// and loads the keypair from that path.
pub fn load_keypair_from_config() -> Result<Keypair, Box<dyn Error>> {
    // Load the Solana CLI config file
    let config_file = solana_cli_config::CONFIG_FILE
        .as_ref()
        .ok_or("Failed to find Solana CLI config file")?;

    let cli_config = Config::load(config_file)?;

    // Get the keypair path from the config
    let keypair_path = cli_config.keypair_path;
    println!("Loading keypair from CLI config: {}", keypair_path);

    // Read the keypair from the specified path
    let keypair = read_keypair_file(&keypair_path)
        .map_err(|e| format!("Failed to read keypair at {}: {}", keypair_path, e))?;

    Ok(keypair)
}

/// Create a memo instruction
///
/// Creates a Solana instruction to submit a memo using the Memo program.
pub fn create_memo_instruction(program_id: Pubkey, signer: &Pubkey, memo: &str) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![AccountMeta::new_readonly(*signer, true)],
        data: memo.as_bytes().to_vec(),
    }
}

// Empty main function to prevent the "main function not found" error when this file is treated as a crate
#[allow(dead_code)]
fn main() {
    // This function is only here to prevent the "main function not found" error
    // It's not meant to be called
}
