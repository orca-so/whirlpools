mod cli;
mod position_manager;
mod utils;
mod wallet;

use std::str::FromStr;

use clap::Parser;
use cli::Args;
use orca_whirlpools::{set_funder, set_whirlpools_config_address, WhirlpoolsConfigInput};
use orca_whirlpools_client::get_position_address;
use position_manager::run_position_manager;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use tokio::time::{sleep, Duration};
use utils::{
    display_position_balances, display_wallet_balances, fetch_mint, fetch_position, fetch_whirlpool,
};

pub const RPC_URL: &str = "https://api.mainnet-beta.solana.com";

#[tokio::main]
async fn main() {
    let args = Args::parse();
    set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaMainnet).unwrap();
    let rpc = RpcClient::new(RPC_URL.to_string());
    let wallet = wallet::load_wallet();
    set_funder(wallet.pubkey()).unwrap();

    let position_mint_address = Pubkey::from_str(&args.position_mint_address).unwrap();

    println!(
        "\n\
        ====================\n\
        🌀 Whirlpool LP BOT \n\
        ====================\n"
    );
    println!("Configuration:");
    println!(
        "  Position Mint Address: {}\n  Threshold: {:.2}%\n  Interval: {} seconds\n  Priority Fee Tier: {:?}\n Slippage tolerance bps: {:?}\n",
        args.position_mint_address, args.threshold, args.interval, args.priority_fee_tier, args.slippage_tolerance_bps
    );

    println!("-------------------------------------\n");

    let (position_address, _) = get_position_address(&position_mint_address).unwrap();
    let mut position = fetch_position(&rpc, &position_address).await.unwrap();

    let whirlpool_address = position.whirlpool;
    let whirlpool = fetch_whirlpool(&rpc, &whirlpool_address).await.unwrap();

    let token_mint_a = fetch_mint(&rpc, &whirlpool.token_mint_a).await.unwrap();
    let token_mint_b = fetch_mint(&rpc, &whirlpool.token_mint_b).await.unwrap();

    display_wallet_balances(
        &rpc,
        &wallet.pubkey(),
        &whirlpool.token_mint_a,
        &whirlpool.token_mint_b,
    )
    .await
    .unwrap();

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
    .unwrap();

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
            eprintln!("Error: {}", err);
        }
        sleep(Duration::from_secs(args.interval)).await;
    }
}
