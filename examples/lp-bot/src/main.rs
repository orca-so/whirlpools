mod cli;
mod position_manager;
mod utils;
mod wallet;

use std::str::FromStr;

use clap::Parser;
use cli::Args;
use position_manager::run_position_manager;
use solana_sdk::pubkey::Pubkey;
use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let wallet = wallet::load_wallet();

    let mut position_mint_address = Pubkey::from_str(&args.position_mint_address).unwrap();

    println!("Position Mint Address: {}", args.position_mint_address);
    println!("Threshold: {:.2}%", args.threshold);
    println!("Interval: {} seconds", args.interval);

    loop {
        if let Err(err) = run_position_manager(&args, &wallet, &mut position_mint_address).await {
            eprintln!("Error: {}", err);
        }
        sleep(Duration::from_secs(args.interval)).await;
    }
}
