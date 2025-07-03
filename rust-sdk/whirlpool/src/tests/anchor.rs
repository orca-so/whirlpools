use std::{env::set_var, error::Error, fs::read_to_string, path::PathBuf, str::FromStr};

use solana_sdk::pubkey::Pubkey;
use toml::Table;

pub fn anchor_programs(path: &str) -> Result<Vec<(String, Pubkey)>, Box<dyn Error>> {
    let mut programs: Vec<(String, Pubkey)> = Vec::new();
    let mut sbf_out_dir: PathBuf = path.parse()?;
    let mut anchor_toml_path = sbf_out_dir.clone();
    sbf_out_dir.push("target/deploy");
    anchor_toml_path.push("Anchor.toml");
    let toml_str = read_to_string(anchor_toml_path)?;
    let parsed_toml = Table::from_str(&toml_str)?;
    let toml_programs_raw = parsed_toml
        .get("programs")
        .and_then(|x| x.get("localnet"))
        .ok_or_else(|| "`programs.localnet` not found in Anchor.toml".to_string())?;
    let toml_programs_parsed = toml_programs_raw
        .as_table()
        .ok_or("Failed to parse `programs.localnet` table.")?;
    for (key, val) in toml_programs_parsed {
        let pubkey_with_quotes = val.to_string();
        let pubkey_str = &pubkey_with_quotes[1..pubkey_with_quotes.len() - 1];
        let pk = Pubkey::from_str(pubkey_str)
            .map_err(|_| format!("Invalid pubkey in `programs.localnet` table. {}", val))?;
        programs.push((key.to_string(), pk));
    }

    // HACK: token_2022.20250510.so must exist in /target/deploy
    // Once we upgrade the development environment with the newer token-2022 program, we can remove this.
    programs.push((
        "token_2022.20250510".to_string(),
        Pubkey::from_str("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb").unwrap(),
    ));

    set_var("SBF_OUT_DIR", sbf_out_dir);
    Ok(programs)
}
