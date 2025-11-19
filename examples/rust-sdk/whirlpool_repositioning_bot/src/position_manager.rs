use crate::{
    cli::Args,
    utils::{
        display_position_balances, display_wallet_balances, fetch_position, fetch_whirlpool,
        send_transaction,
    },
};
use colored::Colorize;
use orca_whirlpools::{
    close_position_instructions, open_position_instructions, IncreaseLiquidityParam,
};
use orca_whirlpools_client::{get_position_address, Position};
use orca_whirlpools_core::{sqrt_price_to_price, tick_index_to_price};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_keypair::Signer;
use spl_token_2022_interface::state::Mint;

pub async fn run_position_manager(
    rpc: &RpcClient,
    args: &Args,
    wallet: &Box<dyn Signer>,
    position: &mut Position,
    token_mint_a: &Mint,
    token_mint_b: &Mint,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("Checking position.");

    let whirlpool_address = position.whirlpool;
    let whirlpool = fetch_whirlpool(rpc, &whirlpool_address)
        .await
        .map_err(|_| "Failed to fetch Whirlpool data.")?;

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

    let deviation_amount = if current_price > position_center_price {
        current_price - position_center_price
    } else {
        position_center_price - current_price
    };
    let deviation_bps = (deviation_amount * 10000.0) / (position_center_price);

    println!("Current pool price: {:.6}", current_price);
    println!(
        "Position price range: [{:.6}, {:.6}]",
        position_lower_price, position_upper_price
    );
    println!("Position center price: {:.6}", position_center_price);
    println!("Price deviation from center: {:.2} bps", deviation_bps);

    if deviation_bps as u16 >= args.threshold {
        println!(
            "{}",
            "Deviation exceeds threshold. Rebalancing position."
                .to_string()
                .yellow()
        );

        let close_position_instructions = close_position_instructions(
            rpc,
            position.position_mint,
            Some(args.slippage_tolerance_bps),
            None,
        )
        .await
        .map_err(|_| "Failed to generate close position instructions.")?;

        let new_lower_price = current_price - (position_upper_price - position_lower_price) / 2.0;
        let new_upper_price = current_price + (position_upper_price - position_lower_price) / 2.0;

        let increase_liquidity_param =
            IncreaseLiquidityParam::Liquidity(close_position_instructions.quote.liquidity_delta);
        let open_position_instructions = open_position_instructions(
            rpc,
            whirlpool_address,
            new_lower_price,
            new_upper_price,
            increase_liquidity_param,
            Some(100),
            None,
        )
        .await
        .map_err(|_| "Failed to generate open position instructions.")?;

        let mut all_instructions = vec![];
        all_instructions.extend(close_position_instructions.instructions);
        all_instructions.extend(open_position_instructions.instructions);

        let mut signers: Vec<&dyn Signer> = vec![wallet.as_ref()];
        signers.extend(
            open_position_instructions
                .additional_signers
                .iter()
                .map(|kp| kp as &dyn Signer),
        );
        signers.extend(
            close_position_instructions
                .additional_signers
                .iter()
                .map(|kp| kp as &dyn Signer),
        );

        let signature = send_transaction(
            rpc,
            wallet.as_ref(),
            &whirlpool_address,
            all_instructions,
            signers,
            args.priority_fee_tier,
            args.max_priority_fee_lamports,
        )
        .await
        .map_err(|_| "Failed to send rebalancing transaction.")?;
        println!("Rebalancing transaction signature: {}", signature);

        let position_mint_address = open_position_instructions.position_mint;
        println!("New position mint address: {}", position_mint_address);
        let (position_address, _) = get_position_address(&position_mint_address)
            .map_err(|_| "Failed to derive new position address.")?;
        *position = fetch_position(rpc, &position_address)
            .await
            .map_err(|_| "Failed to fetch new position data.")?;

        display_wallet_balances(
            rpc,
            &wallet.pubkey(),
            &whirlpool.token_mint_a,
            &whirlpool.token_mint_b,
        )
        .await
        .map_err(|_| "Failed to display wallet balances.")?;

        display_position_balances(
            rpc,
            position,
            &whirlpool.token_mint_a,
            &whirlpool.token_mint_b,
            token_mint_a.decimals,
            token_mint_b.decimals,
            args.slippage_tolerance_bps,
        )
        .await
        .map_err(|_| "Failed to display position balances.")?;
    } else {
        println!(
            "{}",
            "Current price is within range. No repositioning needed."
                .to_string()
                .green()
        );
    }
    Ok(())
}
