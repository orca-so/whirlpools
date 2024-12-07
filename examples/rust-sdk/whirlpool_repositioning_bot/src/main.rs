mod cli;
mod position_manager;
mod utils;
mod wallet;

use clap::Parser;
use cli::Args;
use colored::Colorize;
use dotenv::dotenv;
use orca_whirlpools::{set_funder, set_whirlpools_config_address, WhirlpoolsConfigInput};
use orca_whirlpools_client::get_position_address;
use position_manager::run_position_manager;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::env;
use std::str::FromStr;
use tokio::time::{sleep, Duration};
use utils::{
    display_position_balances, display_wallet_balances, fetch_mint, fetch_position, fetch_whirlpool,
};

#[tokio::main]
async fn main() {
    let args = Args::parse();
    dotenv().ok();
    let rpc_url = env::var("RPC_URL").unwrap();
    let rpc = RpcClient::new(rpc_url.to_string());
    set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaMainnet)
        .expect("Failed to set Whirlpools config address for specified network.");
    let wallet = wallet::load_wallet();
    set_funder(wallet.pubkey()).expect("Failed to set funder address.");

    let position_mint_address = Pubkey::from_str(&args.position_mint_address)
        .expect("Invalid position mint address provided.");

    println!(
        "\n\
        ====================\n\
        🌀 Whirlpool LP BOT \n\
        ====================\n"
    );
    println!("Configuration:");
    println!(
        "  Position Mint Address: {}\n  Threshold: {:.2}%\n  Interval: {} seconds\n  Priority Fee Tier: {:?}\n  Slippage tolerance bps: {:?}\n",
        args.position_mint_address, args.threshold, args.interval, args.priority_fee_tier, args.slippage_tolerance_bps
    );

    println!("-------------------------------------\n");

    let (position_address, _) =
        get_position_address(&position_mint_address).expect("Failed to derive position address.");
    let mut position = fetch_position(&rpc, &position_address)
        .await
        .expect("Failed to fetch position data.");
    let whirlpool = fetch_whirlpool(&rpc, &position.whirlpool)
        .await
        .expect("Failed to fetch Whirlpool data.");
    let token_mint_a = fetch_mint(&rpc, &whirlpool.token_mint_a)
        .await
        .expect("Failed to fetch Token Mint A data.");
    let token_mint_b = fetch_mint(&rpc, &whirlpool.token_mint_b)
        .await
        .expect("Failed to fetch Token Mint B data.");

    display_wallet_balances(
        &rpc,
        &wallet.pubkey(),
        &whirlpool.token_mint_a,
        &whirlpool.token_mint_b,
    )
    .await
    .expect("Failed to display wallet balances.");

    display_position_balances(
        &rpc,
        &position,
        &whirlpool.token_mint_a,
        &whirlpool.token_mint_b,
        token_mint_a.decimals,
        token_mint_b.decimals,
        args.slippage_tolerance_bps,
    )
    .await
    .expect("Failed to display position balances.");

    loop {
        if let Err(err) = run_position_manager(
            &rpc,
            &args,
            &wallet,
            &mut position,
            &token_mint_a,
            &token_mint_b,
        )
        .await
        {
            eprintln!("{}", format!("Error: {}", err).to_string().red());
        }
        sleep(Duration::from_secs(args.interval)).await;
    }
}
