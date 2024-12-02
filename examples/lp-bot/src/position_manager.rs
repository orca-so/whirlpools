use crate::{
    cli::Args,
    utils::{fetch_mint, fetch_position, fetch_whirlpool, send_transaction},
};
use orca_whirlpools::{
    close_position_instructions, open_position_instructions, set_funder,
    set_whirlpools_config_address, IncreaseLiquidityParam, WhirlpoolsConfigInput,
};
use orca_whirlpools_client::get_position_address;
use orca_whirlpools_core::{sqrt_price_to_price, tick_index_to_price};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{pubkey::Pubkey, signer::Signer};

pub async fn run_position_manager(
    args: &Args,
    wallet: &Box<dyn Signer>,
    position_mint_address: &mut Pubkey,
) -> Result<(), Box<dyn std::error::Error>> {
    set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaMainnet).unwrap();
    let rpc = RpcClient::new("https://api.mainnet-beta.solana.com".to_string());
    set_funder(wallet.pubkey()).unwrap();

    println!("Checking position...");
    let (position_address, _) = get_position_address(&position_mint_address).unwrap();
    let position = fetch_position(&rpc, &position_address).await?;

    let whirlpool_address = position.whirlpool;
    let whirlpool = fetch_whirlpool(&rpc, &whirlpool_address).await?;

    let token_mint_a = fetch_mint(&rpc, &whirlpool.token_mint_a).await?;
    let token_mint_b = fetch_mint(&rpc, &whirlpool.token_mint_b).await?;

    let current_price = sqrt_price_to_price(
        whirlpool.sqrt_price,
        token_mint_a.decimals,
        token_mint_b.decimals,
    );
    let position_lower_price = tick_index_to_price(
        position.tick_lower_index,
        token_mint_a.decimals,
        token_mint_b.decimals,
    );
    let position_upper_price = tick_index_to_price(
        position.tick_upper_index,
        token_mint_a.decimals,
        token_mint_b.decimals,
    );
    let position_center_price = (position_lower_price + position_upper_price) / 2.0;

    let deviation = ((current_price - position_center_price).abs() / position_center_price) * 100.0;
    println!("Current pool price: {:.6}", current_price);
    println!(
        "Position price range: [{:.6}, {:.6}]",
        position_lower_price, position_upper_price
    );
    println!("Position center price: {:.6}", position_center_price);
    println!("Price deviation from center: {:.2}%", deviation);

    if deviation >= args.threshold {
        println!("Deviation exceeds threshold. Closing position...");
        let close_position_instructions =
            close_position_instructions(&rpc, *position_mint_address, Some(100), None).await?;
        let signature = send_transaction(
            &rpc,
            wallet.as_ref(),
            close_position_instructions.instructions,
            vec![],
        )
        .await?;
        println!("Close position transaction signature: {}", signature);

        let new_lower_price = current_price - (position_upper_price - position_lower_price) / 2.0;
        let new_upper_price = current_price + (position_upper_price - position_lower_price) / 2.0;
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
        .await?;
        let signature = send_transaction(
            &rpc,
            wallet.as_ref(),
            open_position_instructions.instructions,
            open_position_instructions
                .additional_signers
                .iter()
                .map(|kp| kp as &dyn Signer)
                .collect(),
        )
        .await?;
        println!("Open position transaction signature: {}", signature);
        println!(
            "New position mint address: {}",
            open_position_instructions.position_mint
        );
        *position_mint_address = open_position_instructions.position_mint;
    } else {
        println!("Current price is within range. No repositioning needed.");
    }
    Ok(())
}
