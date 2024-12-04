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

pub const RPC_URL: &str =
    "https://mainnet.helius-rpc.com/?api-key=e1bbe936-f564-4d9a-ae4e-a69e6f99e9b1";

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let wallet = wallet::load_wallet();

    let mut position_mint_address = Pubkey::from_str(&args.position_mint_address).unwrap();

    println!(
        "\n\
        ====================\n\
        🌀 Whirlpool LP BOT \n\
        ====================\n"
    );
    println!("Configuration:");
    println!(
        "  Position Mint Address: {}\n  Threshold: {:.2}%\n  Interval: {} seconds\n  Priority Fee Tier: {:?}\n",
        args.position_mint_address, args.threshold, args.interval, args.priority_fee_tier
    );
    println!("-------------------------------------\n");

    loop {
        if let Err(err) = run_position_manager(&args, &wallet, &mut position_mint_address).await {
            eprintln!("Error: {}", err);
        }
        sleep(Duration::from_secs(args.interval)).await;
    }
}
