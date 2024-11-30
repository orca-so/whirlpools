use clap::Parser;
use orca_whirlpools::{
    close_position_instructions, open_position_instructions, set_funder,
    set_whirlpools_config_address, IncreaseLiquidityParam, WhirlpoolsConfigInput,
};
use orca_whirlpools_client::{get_position_address, Position, Whirlpool};
use orca_whirlpools_core::{sqrt_price_to_price, tick_index_to_price};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::message::{self, Message};
use solana_sdk::program_pack::Pack;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::transaction::Transaction;
use solana_sdk::{signature::Keypair, signer::Signer};
use spl_token_2022::state::Mint;
use std::str::FromStr;
use std::{fs, vec};
use tokio::time::{sleep, Duration};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Position mint address
    #[arg(short, long)]
    position_mint_address: String,

    /// Threshold for repositioning (in percentage)
    #[arg(short, long, default_value_t = 1.0)]
    threshold: f64,

    /// Time interval for checking (in seconds)
    #[arg(short, long, default_value_t = 60)]
    interval: u64,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    
    set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaMainnet).unwrap();
    let rpc = RpcClient::new("https://api.mainnet-beta.solana.com".to_string());
    let wallet = load_wallet();
    set_funder(wallet.pubkey()).unwrap();

    let mut position_mint_address = Pubkey::from_str(&args.position_mint_address).unwrap();
    let threshold = args.threshold;
    let interval = args.interval;

    println!("Position Mint Address: {}", position_mint_address);
    println!("Threshold: {:.2}%", threshold);
    println!("Interval: {} seconds", interval);

    loop {
        println!("Checking position...");
        let (position_address, _) = get_position_address(&position_mint_address).unwrap();
        let position_account = rpc.get_account(&position_address).await.unwrap();
        let position: Position = Position::from_bytes(&position_account.data).unwrap();

        let whirlpool_address = position.whirlpool;
        let whirlpool_account = rpc.get_account(&whirlpool_address).await.unwrap();
        let whirlpool = Whirlpool::from_bytes(&whirlpool_account.data).unwrap();

        let token_mint_a_address = whirlpool.token_mint_a;
        let token_mint_a_account = rpc.get_account(&token_mint_a_address).await.unwrap();
        let token_mint_a = Mint::unpack(&token_mint_a_account.data).unwrap();
        let decimals_a = token_mint_a.decimals;

        let token_mint_b_address = whirlpool.token_mint_b;
        let token_mint_b_account = rpc.get_account(&token_mint_b_address).await.unwrap();
        let token_mint_b = Mint::unpack(&token_mint_b_account.data).unwrap();
        let decimals_b = token_mint_b.decimals;

        let current_price = sqrt_price_to_price(whirlpool.sqrt_price, decimals_a, decimals_b);
        let position_lower_price =
            tick_index_to_price(position.tick_lower_index, decimals_a, decimals_b);
        let position_upper_price =
            tick_index_to_price(position.tick_upper_index, decimals_a, decimals_b);
        let position_center_price = (position_lower_price + position_upper_price) / 2.0;

        let deviation = ((current_price - position_center_price).abs() / position_center_price) * 100.0;
        println!("Current pool price: {:.6}", current_price);
        println!("Position price range: [{:.6}, {:.6}]", position_lower_price, position_upper_price);
        println!("Position center price: {:.6}", position_center_price);
        println!("Price deviation from center: {:.2}%", deviation);

        if deviation >= threshold {
            println!("Deviation exceeds threshold. Closing position...");
            let close_position_instructions =
                close_position_instructions(&rpc, position_mint_address, Some(100), None)
                    .await
                    .unwrap();
            let recent_blockhash = rpc.get_latest_blockhash().await.unwrap();
            let message = Message::new(
                &close_position_instructions.instructions,
                Some(&wallet.pubkey()),
            );
            let transaction = Transaction::new(&vec![wallet.as_ref()], message, recent_blockhash);
            let signature = rpc
                .send_and_confirm_transaction(&transaction)
                .await
                .unwrap();
            println!("Close position transaction signature: {}", signature);

            let new_lower_price = current_price - (position_upper_price - position_lower_price) / 2.0;
            let new_upper_price = current_price + (position_upper_price - position_lower_price) / 2.0;
            println!("New position price range: [{:.6}, {:.6}]", new_lower_price, new_upper_price);
            println!("Opening new position with adjusted range...");
            let increase_liquidity_param =
                IncreaseLiquidityParam::Liquidity(close_position_instructions.quote.liquidity_delta);
            let open_position_instructions = open_position_instructions(
                &rpc,
                whirlpool_address,
                new_lower_price,
                new_upper_price,
                increase_liquidity_param,
                Some(100),
                None,
            )
            .await
            .unwrap();
            let recent_blockhash = rpc.get_latest_blockhash().await.unwrap();
            let message = Message::new(
                &open_position_instructions.instructions,
                Some(&wallet.pubkey()),
            );
            let mut signers: Vec<&dyn Signer> = vec![wallet.as_ref()];
            signers.extend(
                open_position_instructions
                    .additional_signers
                    .iter()
                    .map(|kp| kp as &dyn Signer),
            );
            let transaction = Transaction::new(&signers, message, recent_blockhash);
            let signature = rpc
                .send_and_confirm_transaction(&transaction)
                .await
                .unwrap();
            println!("Open position transaction signature: {}", signature);
            println!("New position mint address: {}", open_position_instructions.position_mint);
            position_mint_address = open_position_instructions.position_mint;
        } else {
            println!("Current price is within range. No repositioning needed.");
        }
        sleep(Duration::from_secs(interval)).await;
    }
}

fn load_wallet() -> Box<dyn Signer> {
    let wallet_string = fs::read_to_string("wallet.json").unwrap();
    let keypair_bytes: Vec<u8> = serde_json::from_str(&wallet_string).unwrap();
    let wallet = Keypair::from_bytes(&keypair_bytes).unwrap();
    Box::new(wallet)
}
